/**
 * M3 full-basket comparison from local HTML already obtained by an authorized
 * operator. Zero network access; source-rights status is never falsified.
 *
 * This is a technical preview, NOT proof that capture consent, checkout prices,
 * stock or a public savings claim have been established.
 */
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { priceInstantNs } from '../src/data/schemaOrgProduct.ts'
import { parseOfflineRetailerSnapshot } from './retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { validateM3RetailerCapturePlan } from './retailer-m3-authorized-22-capture.mjs'
import { renderPrivateComparison } from './retailer-show-private-comparison.mjs'

const MAX_MANIFEST = 96 * 1024
const MAX_HTML = 2 * 1024 * 1024
const SAFE_HTML_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.html$/
const SAFE_CAPTURE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readPinnedPrivateFile(filename, maxBytes) {
  const link = await lstat(filename)
  assert(link.isFile() && !link.isSymbolicLink() &&
    link.nlink === 1 && (link.mode & 0o077) === 0 &&
    link.size >= 1 && link.size <= maxBytes,
    'Offline M3 file must be a private bounded regular file')
  assert(typeof constants.O_NOFOLLOW === 'number',
    'No-follow filesystem support required')
  const fd = await open(filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const start = await fd.stat({ bigint: true })
    assert(start.isFile() && start.nlink === 1n &&
      (start.mode & 0o077n) === 0n &&
      start.dev === BigInt(link.dev) && start.ino === BigInt(link.ino) &&
      start.size >= 1n && start.size <= BigInt(maxBytes),
      'Offline M3 source changed before read')
    let bytes = 0
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const parts = []
    for (;;) {
      const { bytesRead } = await fd.read(buffer, 0, buffer.byteLength, null)
      if (bytesRead === 0) break
      bytes += bytesRead
      assert(bytes <= maxBytes, 'Offline M3 source exceeded byte limit')
      parts.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    const end = await fd.stat({ bigint: true })
    assert(bytes === Number(start.size) &&
      end.dev === start.dev && end.ino === start.ino &&
      end.size === start.size && end.mtimeNs === start.mtimeNs &&
      end.ctimeNs === start.ctimeNs,
      'Offline M3 source changed while reading')
    return Buffer.concat(parts, bytes)
  } finally {
    await fd.close()
  }
}

function decodeExactUtf8(bytes) {
  const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(bytes)
  assert(Buffer.from(value, 'utf8').equals(bytes),
    'Offline M3 UTF-8 bytes could not be preserved exactly')
  return value
}

export function validateOfflineM3SnapshotManifest(manifest) {
  const { requirements, sources } = validateM3RetailerCapturePlan(manifest)
  assert(Array.isArray(manifest.snapshots) &&
    manifest.snapshots.length === sources.length,
    'Offline M3 manifest must supply one snapshot per unique product URL')
  const sourceMap = new Map(sources.map(source => [
    source.supermarket + ':' + source.url, source,
  ]))
  const names = new Set()
  const matched = new Set()
  const captures = []
  for (const entry of manifest.snapshots) {
    const key = entry?.supermarket + ':' + entry?.url
    const source = sourceMap.get(key)
    assert(source && !matched.has(key) &&
      typeof entry.htmlFile === 'string' &&
      SAFE_HTML_NAME.test(entry.htmlFile) &&
      basename(entry.htmlFile) === entry.htmlFile &&
      !isAbsolute(entry.htmlFile) && !names.has(entry.htmlFile) &&
      typeof entry.capturedAt === 'string' &&
      SAFE_CAPTURE_TIME.test(entry.capturedAt) &&
      priceInstantNs(entry.capturedAt, false) !== null,
      'Invalid or duplicate M3 local HTML source')
    names.add(entry.htmlFile)
    matched.add(key)
    captures.push({
      source: {
        ...source,
        id: source.supermarket + '-m3-product-' +
          createHash('sha256').update(source.url).digest('hex').slice(0, 20),
      },
      htmlFile: entry.htmlFile,
      capturedAt: entry.capturedAt,
    })
  }
  assert(matched.size === sourceMap.size,
    'M3 local HTML source coverage incomplete')
  return { requirements, captures }
}

/** Parse all 22 source snapshots first, then make one SAME-DEMAND decision. */
export async function compareOfflineM3RetailerBasket(manifestPath, nowMs = Date.now()) {
  assert(Number.isSafeInteger(nowMs) && nowMs >= 0,
    'Invalid offline M3 reference clock')
  assert(typeof manifestPath === 'string' && manifestPath.trim() &&
    manifestPath === manifestPath.trim(),
    'Invalid offline M3 manifest path')

  // The manifest and all HTML must reside in one operator-owned directory.
  // Private snapshots are never logged, uploaded or fetched by this command.
  const input = resolve(manifestPath)
  const root = await realpath(dirname(input))
  assert(root === dirname(input), 'Symlinked offline M3 root refused')
  const bytes = await readPinnedPrivateFile(input, MAX_MANIFEST)
  const manifest = JSON.parse(decodeExactUtf8(bytes))
  const { requirements, captures } = validateOfflineM3SnapshotManifest(manifest)
  // Validate the complete shape/clock before any product HTML file is opened.
  compareReviewedCatalogs({ requirements, observations: [], nowMs })

  const observations = []
  const captureSummary = []
  const hashes = new Set()
  for (const capture of captures) {
    const sourceBytes = await readPinnedPrivateFile(
      join(root, capture.htmlFile), MAX_HTML)
    const html = decodeExactUtf8(sourceBytes)
    const parsed = parseOfflineRetailerSnapshot({
      source: capture.source, html, capturedAt: capture.capturedAt,
    })
    const hash = createHash('sha256').update(sourceBytes).digest('hex')
    assert(parsed.provenance.sha256 === hash,
      'Offline M3 captured bytes do not match parser provenance')
    const priced = parsed.observations.some(item =>
      item.availability === 'available' &&
      Number.isSafeInteger(item.currentPriceCents) &&
      item.currentPriceCents >= 0)
    if (priced) {
      assert(!hashes.has(hash),
        'Duplicate priced M3 snapshot cannot represent independent captures')
      hashes.add(hash)
    }
    observations.push(...parsed.observations)
    captureSummary.push({
      supermarket: capture.source.supermarket,
      sourceId: capture.source.id,
      capturedAt: capture.capturedAt,
      sha256: hash,
      bytes: sourceBytes.byteLength,
      parsedProducts: parsed.observations.length,
      rejected: parsed.rejected,
    })
  }

  return {
    provenance: 'operator-supplied-offline-html-preview',
    claimable: false,
    sourceRightsAsserted: false,
    warning: 'No automatic retailer scraping. Source-use rights, checkout prices and savings are NOT established',
    requiredIngredientCount: requirements.length,
    captureSummary,
    comparison: compareReviewedCatalogs({ requirements, observations, nowMs }),
  }
}

export async function main(argv = process.argv.slice(2)) {
  assert((argv.length === 2 || (argv.length === 3 && argv[2] === '--text')) &&
    argv[0] === '--offline' && typeof argv[1] === 'string' &&
    !argv[1].startsWith('-'),
    'Usage: node --experimental-strip-types scripts/retailer-m3-offline-22-snapshots.mjs --offline private-manifest.json [--text]')
  const result = await compareOfflineM3RetailerBasket(argv[1])
  if (argv[2] === '--text') {
    // Reuse the already reviewed private reporter with independent physical
    // pack reconciliation. Never fabricate public savings or stock evidence.
    process.stdout.write(renderPrivateComparison({
      format: 'supa-local-snapshot-comparison-v1',
      captureSummary: result.captureSummary,
      comparison: result.comparison,
    }) + '\n')
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
}

if (process.argv[1] && import.meta.url ===
    pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private M3 offline comparison refused: review source files, captured-at and manifest integrity')
    process.exitCode = 1
  })
}
