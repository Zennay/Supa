import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SOURCES } from './m1-capture-sources.mjs'
import { parseOfflineRetailerSnapshot } from './retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

const MAX_MANIFEST_BYTES = 96 * 1024
const MAX_HTML_BYTES = 2 * 1024 * 1024

async function readBoundedFile(filename, limit) {
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) {
    throw new Error('Input is not a bounded ordinary file')
  }
  const body = await readFile(filename)
  if (body.byteLength > limit) throw new Error('Input exceeded size limit')
  return body.toString('utf8')
}

export async function compareLocalRetailerSnapshots(manifestPath, nowMs = Date.now()) {
  const root = await realpath(dirname(resolve(manifestPath)))
  const manifest = JSON.parse(await readBoundedFile(resolve(manifestPath), MAX_MANIFEST_BYTES))
  if (manifest?.version !== 1 || !Array.isArray(manifest.requirements) ||
      !Array.isArray(manifest.snapshots) || manifest.snapshots.length < 2 ||
      manifest.snapshots.length > 100) throw new Error('Invalid offline comparison manifest')

  const observations = []
  const captureSummary = []
  const distinctSources = new Set()
  for (const entry of manifest.snapshots) {
    if (typeof entry?.sourceId !== 'string' ||
        typeof entry?.htmlFile !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(entry.htmlFile) ||
        isAbsolute(entry.htmlFile) || basename(entry.htmlFile) !== entry.htmlFile ||
        distinctSources.has(entry.sourceId)) {
      throw new Error('Invalid or duplicate offline snapshot reference')
    }
    distinctSources.add(entry.sourceId)
    const source = SOURCES.find((candidate) => candidate.id === entry.sourceId)
    if (!source) throw new Error('Offline snapshot source is not on the allowlist')
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

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 && !(argv.length === 3 && argv[1] === '--out')) {
    throw new Error('Usage: node --experimental-strip-types scripts/retailer-compare-local-snapshots.mjs manifest.json [--out result.json]')
  }
  const result = await compareLocalRetailerSnapshots(argv[0])
  const payload = JSON.stringify(result, null, 2) + '\n'
  if (argv.length === 3) {
    await writeFile(argv[2], payload, { flag: 'wx', mode: 0o600 })
    console.log('Offline comparison written to a new private file')
  } else {
    console.log(payload)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
