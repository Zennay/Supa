import { lstat, open, realpath, link, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { SOURCES } from './m1-capture-sources.mjs'
import { parseOfflineRetailerSnapshot } from './retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { priceInstantNs } from '../src/data/schemaOrgProduct.ts'

const MAX_MANIFEST_BYTES = 96 * 1024
const MAX_HTML_BYTES = 2 * 1024 * 1024

async function readBoundedFile(filename, limit) {
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) {
    throw new Error('Input is not a bounded ordinary file')
  }
  // Opening by name after lstat alone allows a symlink/FIFO swap during the
  // await gap. Read from a pinned descriptor which refuses final symlinks
  // and blocking special files, then confirm the actual descriptor is bounded.
  const handle = await open(filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const pinned = await handle.stat()
    if (!pinned.isFile() || pinned.size > limit) {
      throw new Error('Input is not a bounded ordinary file')
    }
    const body = await handle.readFile()
    if (body.byteLength > limit) throw new Error('Input exceeded size limit')
    // A lossy Buffer.toString() silently replaces malformed UTF-8 bytes,
    // so the later source SHA would fingerprint different bytes. Refuse such
    // captures and retain a valid UTF-8 BOM when present: the parsed string
    // can then be re-encoded byte-for-byte to match the pinned source file.
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)
    } catch {
      throw new Error('Invalid UTF-8 in offline snapshot input')
    }
  } finally {
    await handle.close()
  }
}

export async function compareLocalRetailerSnapshots(manifestPath, nowMs = Date.now()) {
  const root = await realpath(dirname(resolve(manifestPath)))
  const manifest = JSON.parse(await readBoundedFile(resolve(manifestPath), MAX_MANIFEST_BYTES))
  if (manifest?.version !== 1 || !Array.isArray(manifest.requirements) ||
      !Array.isArray(manifest.snapshots) || manifest.snapshots.length < 2 ||
      manifest.snapshots.length > 100) throw new Error('Invalid offline comparison manifest')

  // Requirements and the review clock must be canonical before any of the
  // potentially 100 bounded HTML source files are opened. Incomplete but
  // valid quantities still become a safe unknown comparison as before.
  compareReviewedCatalogs({
    requirements: manifest.requirements, observations: [], nowMs,
  })

  const distinctSources = new Set()
  const distinctCaptureFiles = new Set()
  // First validate EVERY reference, before opening even the first source
  // HTML file. A later duplicate, unsafe path or invalid timestamp must
  // not cause needless processing of an earlier retailer capture.
  const validatedSnapshots = manifest.snapshots.map((entry) => {
    if (typeof entry?.sourceId !== 'string' ||
        typeof entry?.htmlFile !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(entry.htmlFile) ||
        isAbsolute(entry.htmlFile) || basename(entry.htmlFile) !== entry.htmlFile ||
        distinctSources.has(entry.sourceId) ||
        distinctCaptureFiles.has(entry.htmlFile)) {
      throw new Error('Invalid or duplicate offline snapshot reference')
    }
    distinctSources.add(entry.sourceId)
    distinctCaptureFiles.add(entry.htmlFile)
    const source = SOURCES.find((candidate) => candidate.id === entry.sourceId)
    if (!source) throw new Error('Offline snapshot source is not on the allowlist')
    // Captured-at provenance must be an explicit absolute ISO instant.
    // Date.parse alone accepts local clocks, date-only strings, rollovers and
    // impossible timezone offsets. Align with the exact nanosecond source
    // price chronology validator before any retailer HTML is read.
    if (typeof entry.capturedAt !== 'string' ||
        !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:[.][0-9]{1,9})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(entry.capturedAt) ||
        priceInstantNs(entry.capturedAt, false) === null) {
      throw new Error('Invalid bounded offline snapshot')
    }
    return { entry, source }
  })

  const observations = []
  const captureSummary = []
  const distinctCaptureHashes = new Set()
  for (const { entry, source } of validatedSnapshots) {
    const candidatePath = join(root, entry.htmlFile)
    if ((await lstat(candidatePath)).isSymbolicLink()) {
      throw new Error('Input is not a bounded ordinary file')
    }
    const file = await realpath(candidatePath)
    if (!file.startsWith(root + sep)) throw new Error('Offline HTML must be inside manifest folder')
    const html = await readBoundedFile(file, MAX_HTML_BYTES)
    const extracted = parseOfflineRetailerSnapshot({
      source, html, capturedAt: entry.capturedAt,
    })
    // Two differently named files can still contain a replay of the same
    // captured page. Reject matching bytes across distinct source IDs so
    // the offline preview cannot mint two-store evidence from one capture.
    const captureHash = extracted.provenance.sha256
    // A parsed Product with a null checkout price is *not* priced evidence.
    // Duplicate unpriced pages remain safely incomparable; genuine available
    // priced Products cannot be replayed as a second independent store.
    if (extracted.observations.some((item) =>
      item.availability === 'available' &&
      Number.isSafeInteger(item.currentPriceCents) &&
      item.currentPriceCents >= 0)) {
      if (distinctCaptureHashes.has(captureHash)) {
        throw new Error('Duplicate priced offline HTML capture reused across sources')
      }
      distinctCaptureHashes.add(captureHash)
    }
    observations.push(...extracted.observations)
    captureSummary.push({
      sourceId: source.id,
      supermarket: source.supermarket,
      parsedProducts: extracted.observations.length,
      rejected: extracted.rejected,
      scriptsInspected: extracted.scriptsInspected,
      sha256: extracted.provenance.sha256,
    })
  }
  const comparison = compareReviewedCatalogs({
    requirements: manifest.requirements,
    observations,
    nowMs,
  })
  return {
    format: 'supa-local-snapshot-comparison-v1',
    warning: 'Offline snapshot preview only; not a live retailer price or validated savings claim',
    captureSummary,
    comparison,
  }
}

// Writing directly to the public --out path can leave a truncated/corrupt
// report if the process exits during I/O. Commit only a fully synced 0600
// same-directory temporary file, by an exclusive hard link. Unlike rename,
// link refuses existing targets (including symlinks), so concurrent writers
// cannot replace an existing report or publish partial JSON.
async function publishPrivateReport(destination, payload) {
  const dir = dirname(resolve(destination))
  const temporary = join(dir, '.supa-m3-' + randomUUID() + '.tmp')
  let handle
  try {
    handle = await open(temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600)
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await link(temporary, destination)
  } finally {
    if (handle) await handle.close()
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 && !(argv.length === 3 && argv[1] === '--out')) {
    throw new Error('Usage: node --experimental-strip-types scripts/retailer-compare-local-snapshots.mjs manifest.json [--out result.json]')
  }
  const result = await compareLocalRetailerSnapshots(argv[0])
  const payload = JSON.stringify(result, null, 2) + '\n'
  if (argv.length === 3) {
    await publishPrivateReport(argv[2], payload)
    console.log('Offline comparison written to a new private file')
  } else {
    console.log(payload)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
