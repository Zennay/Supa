import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

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

export async function loadReviewedRepositoryFixtures() {
  // Only these exact bundled files. No user-defined path, URL, HTTP or proxy.
  const root = new URL('../fixtures/m1/', import.meta.url)
  const records = []
  for (const file of RETAILER_REVIEWED_FIXTURES) {
    const url = new URL(file, root)
    const filesystemPath = fileURLToPath(url)
    const info = await stat(filesystemPath)
    if (!info.isFile() || info.size > 1024 * 1024) {
      throw new Error('Reviewed fixture must be a bounded regular file')
    }
    records.push(JSON.parse(await readFile(url, 'utf8')))
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
