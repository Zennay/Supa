import { lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

import { snapshotInertReviewedEvidence } from './retailer-inert-json-admission.mjs'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { parsePlusRenderedProductEvidence } from '../src/data/plusRenderedProduct.ts'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
} from '../src/data/plusRenderedListings.ts'
import { parseDekaMarktSsrProductEvidence } from '../src/data/dekaMarktSsrProduct.ts'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

// Offline ingestion adapter orchestration, not a live scraper or license.
// The six existing M1 independently reviewed capture shapes are strict inputs;
// unrecognized retailer/shape combinations cannot quietly become price facts.
const ADAPTERS = Object.freeze({
  'plus:product': ['plus-browser-rendered-schema-org-product', parsePlusRenderedProductEvidence],
  'plus:catalog': ['plus-browser-rendered-catalog', parsePlusRenderedCatalogEvidence],
  'plus:offers': ['plus-browser-rendered-offers', parsePlusRenderedOffersEvidence],
  'dekamarkt:product': ['dekamarkt-public-ssr-nuxt-product', parseDekaMarktSsrProductEvidence],
  'dekamarkt:catalog': ['dekamarkt-public-ssr-nuxt-catalog', parseDekaMarktSsrCatalogEvidence],
  'dekamarkt:offers': ['dekamarkt-public-ssr-nuxt-offers', parseDekaMarktSsrOffersEvidence],
})

export const RETAILER_REVIEWED_FIXTURES = Object.freeze([
  'plus-rendered-product-halfvolle-melk.v1.json',
  'plus-rendered-catalog.v1.json',
  'plus-rendered-offers.v1.json',
  'dekamarkt-product-halfvolle-melk.v1.json',
  'dekamarkt-catalog-melk.v1.json',
  'dekamarkt-offers.v1.json',
])

function boundedRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validatedInput(record) {
  if (!boundedRecord(record) || !boundedRecord(record.source)) {
    throw new Error('Reviewed ingestion requires a structured source record')
  }
  const key = String(record.source.supermarket) + ':' + String(record.source.kind)
  const adapter = Object.hasOwn(ADAPTERS, key) ? ADAPTERS[key] : null
  if (!adapter || record.evidenceType !== adapter[0] || record.version !== 1) {
    throw new Error('Unapproved retailer or capture shape')
  }
  if (
    typeof record.source.id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(record.source.id)
  ) {
    throw new Error('Unsafe source identity')
  }
  return { key, parser: adapter[1] }
}

function provenanceMatches(source, observation) {
  const actual = observation.provenance
  return actual.supermarket === source.supermarket &&
    actual.kind === source.kind &&
    actual.url === source.url &&
    actual.capturedAt === source.capturedAt &&
    actual.sha256 === source.sha256
}

function ingestSafeReviewedEvidence(record) {
  // Internal only: record already detached at the public entrypoint.
  const { key, parser } = validatedInput(record)
  // The product adapters must never classify a fictional future-dated capture
  // as historical price evidence. Apply the same conservative 60s physical
  // clock tolerance already used by catalog/offers to ALL six source kinds.
  // An absent/unparseable clock cannot authorize an archived observation.
  const capturedAt = record.source.capturedAt
  const capturedMs = typeof capturedAt === 'string' ? Date.parse(capturedAt) : NaN
  if (!Number.isFinite(capturedMs) || capturedMs > Date.now() + 60_000) {
    return { key, accepted: false, reason: 'invalid-or-future-capture', observations: [] }
  }
  let parsed
  try {
    parsed = parser(record)
  } catch {
    return { key, accepted: false, reason: 'adapter-refused', observations: [] }
  }
  if (parsed?.type === 'abstain') {
    return { key, accepted: false, reason: 'adapter-abstained', observations: [] }
  }
  const observations = parsed?.type === 'observation'
    ? [parsed.observation]
    : parsed?.type === 'observations' && Array.isArray(parsed.observations)
      ? parsed.observations
      : []
  if (observations.length === 0 || observations.length > 256) {
    return { key, accepted: false, reason: 'empty-or-oversized', observations: [] }
  }
  const seen = new Set()
  try {
    for (const observation of observations) {
      validateRawProductObservation(observation)
      if (!provenanceMatches(record.source, observation)) {
        throw new Error('unbound provenance')
      }
      const id = observation.sourceProductId
      if (!id || seen.has(id)) throw new Error('duplicate-or-missing-product-identity')
      seen.add(id)
    }
  } catch {
    return { key, accepted: false, reason: 'invalid-observation', observations: [] }
  }
  // No automatic price publication: consumers still need a separate explicit
  // retailer license and production activation decision.
  return { key, accepted: true, reason: null, observations }
}

export function ingestReviewedEvidence(record) {
  return ingestSafeReviewedEvidence(snapshotInertReviewedEvidence(record))
}

export function ingestReviewedBatch(records) {
  // Snapshot the whole collection BEFORE accessing .length, iterators or source IDs.
  records = snapshotInertReviewedEvidence(records)
  if (!Array.isArray(records) || records.length === 0 || records.length > 32) {
    throw new Error('Reviewed batch requires 1–32 source records')
  }
  const unique = new Set()
  const results = []
  for (const record of records) {
    const { key } = validatedInput(record)
    const identifier = key + ':' + record.source.id
    if (unique.has(identifier)) {
      throw new Error('Duplicate reviewed capture identity')
    }
    unique.add(identifier)
    results.push(ingestSafeReviewedEvidence(record))
  }
  const accepted = results.filter(result => result.accepted)
  const summary = {
    mode: 'reviewed-offline-only',
    sources: results.length,
    acceptedSources: accepted.length,
    rejectedSources: results.length - accepted.length,
    observations: accepted.reduce((sum, result) => sum + result.observations.length, 0),
    retailerCounts: {
      plus: accepted.filter(result => result.key.startsWith('plus:')).reduce((sum, result) => sum + result.observations.length, 0),
      dekamarkt: accepted.filter(result => result.key.startsWith('dekamarkt:')).reduce((sum, result) => sum + result.observations.length, 0),
    },
    productionEnabled: false,
    permissionVerified: false,
    publicSavingsClaimEligible: false,
  }
  return { summary, results }
}

// A local archived JSON source must have exactly one meaning. JSON.parse alone
// silently accepts duplicate keys (last wins), including escaped spellings of
// source/capturedAt/offer cents. Inspect bounded raw UTF-8 before parsing.
function parseUnambiguousReviewedFixture(bytes) {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const objects = []
    for (let i = 0; i < raw.length;) {
      const ch = raw[i]
      if (ch === '{' || ch === '[') {
        if (objects.length >= 128) throw new Error('too deeply nested')
        objects.push(ch === '{' ? new Set() : null)
        i++
        continue
      }
      if (ch === '}' || ch === ']') {
        if (objects.length === 0) throw new Error('unbalanced')
        objects.pop()
        i++
        continue
      }
      if (ch !== '"') { i++; continue }
      const start = i++
      while (i < raw.length) {
        if (raw[i] === '\\') { i += 2; continue }
        if (raw[i++] === '"') break
      }
      let next = i
      while (next < raw.length && /[ \n\r\t]/.test(raw[next])) next++
      const scope = objects.at(-1)
      if (raw[next] === ':' && scope instanceof Set) {
        const name = JSON.parse(raw.slice(start, i))
        if (scope.has(name)) throw new Error('duplicate key')
        scope.add(name)
      }
    }
    return JSON.parse(raw)
  } catch {
    throw new Error('Ambiguous or invalid reviewed fixture JSON')
  }
}

// Explicitly resolve one canonical filesystem path and reject every symbolic
// ancestor in that *same* pathname before and after the descriptor read.
async function assertNoReviewedFixtureSymlinkAncestor(full) {
  let path = full
  for (;;) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      throw new Error('Reviewed fixture must be a bounded regular file (symlink ancestor refused)')
    }
    const parent = dirname(path)
    if (parent === path) break
    path = parent
  }
}

// Strict local archive reader. Exported for synthetic filesystem regression
// tests only; the actual six-fixture loader below still fixes all its names.
export async function readBoundedRegularReviewedFixture(filesystemPath) {
  if (typeof filesystemPath !== 'string' || !filesystemPath ||
      filesystemPath.length > 2048) {
    throw new Error('Reviewed fixture must be a bounded regular file')
  }
  const full = resolve(filesystemPath)
  await assertNoReviewedFixtureSymlinkAncestor(full)
  const original = await lstat(full)
  if (!original.isFile() || original.isSymbolicLink() ||
      original.nlink !== 1 || original.size > 1024 * 1024) {
    throw new Error('Reviewed fixture must be a bounded regular file')
  }
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    const stable = (a, b) => a.isFile() && b.isFile() &&
      a.dev === b.dev && a.ino === b.ino && a.nlink === 1 && b.nlink === 1 &&
      a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
    if (!stable(original, opened)) {
      throw new Error('Reviewed fixture identity changed')
    }
    const bytes = await handle.readFile()
    const finalStat = await handle.stat()
    if (bytes.length !== original.size || bytes.length > 1024 * 1024 ||
        !stable(opened, finalStat) ||
        !stable(finalStat, await lstat(full))) {
      throw new Error('Reviewed fixture identity changed')
    }
    await assertNoReviewedFixtureSymlinkAncestor(full)
    return parseUnambiguousReviewedFixture(bytes)
  } finally {
    await handle.close()
  }
}

export async function loadReviewedRepositoryFixtures() {
  // Only these exact bundled files. No user-defined path, URL, HTTP or proxy.
  const root = new URL('../fixtures/m1/', import.meta.url)
  const records = []
  for (const file of RETAILER_REVIEWED_FIXTURES) {
    const url = new URL(file, root)
    records.push(await readBoundedRegularReviewedFixture(fileURLToPath(url)))
  }
  return ingestReviewedBatch(records)
}

export async function main(argv = process.argv.slice(2), writeOutput = text => process.stdout.write(text)) {
  if (argv.length !== 0) throw new Error('Usage: node --experimental-strip-types scripts/retailer-reviewed-ingest-engine.mjs')
  const { summary } = await loadReviewedRepositoryFixtures()
  // Aggregate-only output; no price, product, person, URL or proxy is logged.
  writeOutput(JSON.stringify(summary, null, 2) + '\n')
  if (summary.rejectedSources !== 0 || summary.acceptedSources !== 6) {
    process.exitCode = 2
  }
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Offline retailer fixture batch rejected; no ingestion was published')
    process.exitCode = 2
  })
}
