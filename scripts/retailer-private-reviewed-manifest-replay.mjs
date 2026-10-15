/**
 * Explicitly operator-selected PRIVATE reviewed evidence directory -> all six
 * existing retailer adapters -> provenance-preserving catalog/health summary.
 *
 * No external fetch, HTML scraping, implicit source approval, or price output.
 * Manifest digests pin bytes of already-reviewed JSON evidence, not a license.
 */
import { createHash } from 'node:crypto'
import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ingestReviewedBatch } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'
import { evaluatePrivateAdapterHealth } from './retailer-private-adapter-health.mjs'

const SHAPES = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const fail = () => { throw new Error('Private reviewed retailer capture replay refused') }
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key))
const fileName = value => typeof value === 'string' && value.length <= 128 &&
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(value) && value !== 'manifest.json'
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

async function securePath(p, maxBytes) {
  let current = resolve(p)
  for (;;) {
    const metadata = await lstat(current)
    if (metadata.isSymbolicLink() ||
        (current === resolve(p) && (!metadata.isFile() ||
          metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0 ||
          metadata.size < 2 || metadata.size > maxBytes))) fail()
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const handle = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.nlink !== 1 ||
        (metadata.mode & 0o077) !== 0 || metadata.size > maxBytes) fail()
    const bytes = await handle.readFile()
    if (bytes.length > maxBytes || bytes.length < 2) fail()
    return bytes
  } finally { await handle.close() }
}
function parseStrictJson(bytes) {
  try {
    // JSON.parse accepts duplicate names and silently keeps the last value.
    // A SHA proves which bytes were reviewed, NOT that permission/provenance
    // claims in those bytes have an unambiguous interpretation. Check raw
    // object names at every depth before trusting either manifest or source.
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const scopes = []
    for (let i = 0; i < raw.length;) {
      const ch = raw[i]
      if (ch === '{' || ch === '[') {
        if (scopes.length >= 128) fail()
        scopes.push(ch === '{' ? new Set() : null)
        i++
        continue
      }
      if (ch === '}' || ch === ']') {
        if (!scopes.length) fail()
        scopes.pop()
        i++
        continue
      }
      if (ch !== '"') { i++; continue }
      const start = i++
      // Escaped quotes, slashes and Unicode escapes cannot terminate a name.
      while (i < raw.length) {
        if (raw[i] === '\\') { i += 2; continue }
        if (raw[i++] === '"') break
      }
      let next = i
      while (next < raw.length && (
        raw[next] === ' ' || raw.charCodeAt(next) === 9 ||
        raw.charCodeAt(next) === 13 || raw.charCodeAt(next) === 10)) next++
      const keys = scopes.at(-1)
      if (raw[next] === ':' && keys instanceof Set) {
        // JSON.parse resolves escaped spellings, e.g. "source" and "s\\u006furce".
        const name = JSON.parse(raw.slice(start, i))
        if (keys.has(name)) fail()
        keys.add(name)
      }
    }
    // The built-in parser remains the authoritative grammar/number validator.
    // Scanner only rejects ambiguous object names, never normalizes values.
    return JSON.parse(raw)
  } catch { fail() }
}
function validManifest(manifest) {
  if (!exact(manifest, ['schemaVersion','mode','productionEnabled','permissionVerified',
    'publicSavingsClaimEligible','sources']) || manifest.schemaVersion !== 1 ||
    manifest.mode !== 'private-reviewed-retailer-batch' ||
    manifest.productionEnabled !== false || manifest.permissionVerified !== false ||
    manifest.publicSavingsClaimEligible !== false ||
    !Array.isArray(manifest.sources) || manifest.sources.length < 6 ||
    manifest.sources.length > 32) fail()
  const files = new Set()
  const seenShapes = new Set()
  for (let i = 0; i < manifest.sources.length; i++) {
    if (!Object.hasOwn(manifest.sources, i)) fail()
    const entry = manifest.sources[i]
    if (!exact(entry, ['file','sha256','key']) || !fileName(entry.file) ||
        !sha(entry.sha256) || !SHAPES.includes(entry.key) || files.has(entry.file)) fail()
    files.add(entry.file)
    seenShapes.add(entry.key)
  }
  if (SHAPES.some(key => !seenShapes.has(key))) fail()
}

/** A reviewed and SHA-pinned collection: output is counts ONLY, never evidence. */
export async function replayPrivateReviewedCaptureDirectory(directory, {
  referenceTime = new Date().toISOString(),
} = {}) {
  if (typeof directory !== 'string' || !directory.trim() ||
      directory.startsWith('-') || directory.length > 500) fail()
  const root = resolve(directory)
  const manifestBytes = await securePath(join(root, 'manifest.json'), 65536)
  const manifest = parseStrictJson(manifestBytes)
  validManifest(manifest)
  const records = []
  for (const entry of manifest.sources) {
    const bytes = await securePath(join(root, entry.file), 1024 * 1024)
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) fail()
    const record = parseStrictJson(bytes)
    if (!record || typeof record !== 'object' ||
        record.source?.supermarket + ':' + record.source?.kind !== entry.key) fail()
    records.push(record)
  }
  let batch, catalog, health
  try {
    batch = ingestReviewedBatch(records)
    if (batch.summary.rejectedSources !== 0 ||
        batch.summary.acceptedSources !== manifest.sources.length) fail()
    catalog = buildUniversalRetailerCatalog(batch)
    health = evaluatePrivateAdapterHealth(batch, { referenceTime })
  } catch { fail() }
  if (!health.sixShapeCoverageComplete ||
      catalog.status !== 'private-review-only' ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false) fail()
  return {
    schemaVersion: 1,
    mode: 'private-reviewed-capture-manifest-replay',
    sources: health.sources,
    acceptedSources: health.acceptedSources,
    observations: health.observations,
    products: catalog.productCount,
    captureEvents: catalog.captureCount,
    conflictCount: catalog.conflictCount,
    staleSources: health.staleSources,
    sixShapeCoverageComplete: health.sixShapeCoverageComplete,
    humanReviewRequired: true,
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    livePricesAvailable: false,
    externalRequests: 0,
  }
}
export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--dir') fail()
  const result = await replayPrivateReviewedCaptureDirectory(argv[1])
  write(JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private reviewed retailer capture replay refused')
    process.exitCode = 2
  })
}
