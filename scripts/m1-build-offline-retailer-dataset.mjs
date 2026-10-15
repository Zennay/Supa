/**
 * SUPA priority-1 retailer scraper integration: six reviewed capture adapters
 * -> one provenance-preserving, offline-only candidate dataset.
 *
 * No network, credential, browser, proxy, or implicit current-price access.
 * Historical records are useful to test parsing, never marketing evidence.
 */
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parsePlusRenderedCatalogEvidence, parsePlusRenderedOffersEvidence } from '../src/data/plusRenderedListings.ts'
import { parsePlusRenderedProductEvidence } from '../src/data/plusRenderedProduct.ts'
import { parseDekaMarktSsrCatalogEvidence, parseDekaMarktSsrOffersEvidence } from '../src/data/dekaMarktSsrListings.ts'
import { parseDekaMarktSsrProductEvidence } from '../src/data/dekaMarktSsrProduct.ts'
import { validateRawProductObservation } from '../src/data/ingestion.ts'

export const RETAILER_SOURCES = Object.freeze([
  { key: 'plus-product', supermarket: 'plus', kind: 'product', file: 'plus-rendered-product-halfvolle-melk.v1.json', parse: parsePlusRenderedProductEvidence },
  { key: 'plus-catalog', supermarket: 'plus', kind: 'catalog', file: 'plus-rendered-catalog.v1.json', parse: parsePlusRenderedCatalogEvidence },
  { key: 'plus-offers', supermarket: 'plus', kind: 'offers', file: 'plus-rendered-offers.v1.json', parse: parsePlusRenderedOffersEvidence },
  { key: 'dekamarkt-product', supermarket: 'dekamarkt', kind: 'product', file: 'dekamarkt-product-halfvolle-melk.v1.json', parse: parseDekaMarktSsrProductEvidence },
  { key: 'dekamarkt-catalog', supermarket: 'dekamarkt', kind: 'catalog', file: 'dekamarkt-catalog-melk.v1.json', parse: parseDekaMarktSsrCatalogEvidence },
  { key: 'dekamarkt-offers', supermarket: 'dekamarkt', kind: 'offers', file: 'dekamarkt-offers.v1.json', parse: parseDekaMarktSsrOffersEvidence },
])
const MAX_FIXTURE_BYTES = 1024 * 1024
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000

function fail(reason) {
  throw new Error('Retailer offline extraction refused: ' + reason)
}
function ownRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function stableIdentity(observation) {
  return observation.supermarket + ':' + observation.sourceProductId
}
function observedAtStatus(capturedAt, referenceNowMs) {
  const captureMs = Date.parse(capturedAt)
  if (!Number.isFinite(captureMs)) return 'invalid'
  if (captureMs > referenceNowMs) return 'future'
  return referenceNowMs - captureMs <= MAX_SNAPSHOT_AGE_MS ? 'fresh' : 'stale'
}

/** Strict deterministic adapter integration; caller supplies reviewed evidence
 * JSON parsed from permitted local snapshots. No HTTP is ever performed. */
export function buildOfflineRetailerDataset(input, { referenceNowMs = Date.now() } = {}) {
  if (!ownRecord(input) || !Number.isFinite(referenceNowMs)) fail('invalid source bundle or reference clock')
  const expected = RETAILER_SOURCES.map(item => item.key).sort()
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected)) {
    fail('six exact PLUS and DekaMarkt source kinds are required')
  }
  const snapshots = []
  const records = []
  const sourceIds = new Set()
  for (const spec of RETAILER_SOURCES) {
    const evidence = input[spec.key]
    if (!ownRecord(evidence) || !ownRecord(evidence.source) ||
        evidence.source.supermarket !== spec.supermarket || evidence.source.kind !== spec.kind ||
        typeof evidence.source.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(evidence.source.id) ||
        sourceIds.has(evidence.source.id)) {
      fail('source kind, unique ID or supermarket differs from fixed adapter: ' + spec.key)
    }
    sourceIds.add(evidence.source.id)
    const parsed = spec.parse(evidence)
    if (!ownRecord(parsed) || parsed.type === 'abstain') {
      fail('trusted adapter abstained for ' + spec.key)
    }
    let observations
    if (spec.kind === 'product' && parsed.type === 'observation') {
      observations = [parsed.observation]
    } else if (spec.kind !== 'product' && parsed.type === 'observations' &&
               Array.isArray(parsed.observations) && Number.isSafeInteger(parsed.abstained)) {
      observations = parsed.observations
    } else {
      fail('unexpected adapter result for ' + spec.key)
    }
    if (observations.length === 0 || observations.length > 2000) {
      fail('empty or unbounded observation set: ' + spec.key)
    }
    const captureStatus = observedAtStatus(evidence.source.capturedAt, referenceNowMs)
    if (captureStatus === 'invalid' || captureStatus === 'future') {
      fail('invalid or future-dated source evidence: ' + spec.key)
    }
    const identity = new Set()
    for (const raw of observations) {
      const observation = validateRawProductObservation(raw)
      if (observation.supermarket !== spec.supermarket ||
          observation.provenance.kind !== spec.kind ||
          observation.provenance.supermarket !== evidence.source.supermarket ||
          observation.provenance.url !== evidence.source.url ||
          observation.provenance.sha256 !== evidence.source.sha256 ||
          observation.provenance.capturedAt !== evidence.source.capturedAt ||
          typeof observation.sourceProductId !== 'string') {
        fail('observation lost exact source provenance or product ID: ' + spec.key)
      }
      const id = stableIdentity(observation)
      if (identity.has(id)) fail('duplicate product identity within source: ' + spec.key)
      identity.add(id)
      records.push({ kind: spec.kind, sourceKey: spec.key, freshness: captureStatus, observation })
    }
    snapshots.push({
      sourceKey: spec.key, supermarket: spec.supermarket, kind: spec.kind,
      sourceId: evidence.source.id, sourceUrl: evidence.source.url,
      capturedAt: evidence.source.capturedAt, sha256: evidence.source.sha256,
      freshness: captureStatus, acceptedCount: observations.length,
      abstainedCount: spec.kind === 'product' ? 0 : parsed.abstained,
    })
  }

  // Do not mistake a promotion for the regular product price. Cross-page
  // contradictions must also not silently win by choosing the cheaper page.
  const grouped = new Map()
  for (const record of records) {
    const id = stableIdentity(record.observation)
    const entry = grouped.get(id) ?? { supermarket: record.observation.supermarket, productId: record.observation.sourceProductId, records: [] }
    entry.records.push(record)
    grouped.set(id, entry)
  }
  const candidateProducts = []
  const conflicts = []
  for (const entry of grouped.values()) {
    const standard = entry.records.filter(r => r.kind === 'product' || r.kind === 'catalog')
    const offers = entry.records.filter(r => r.kind === 'offers')
    // No offer-only products are treated as baseline current-price evidence.
    if (standard.length === 0) continue
    const cents = new Set(standard.map(r => r.observation.currentPriceCents))
    const names = new Set(standard.map(r => r.observation.name.trim().toLowerCase()))
    if (cents.size !== 1 || names.size !== 1) {
      conflicts.push({ supermarket: entry.supermarket, productId: entry.productId, reason: 'product/catalog disagreement' })
      continue
    }
    // A separate observed offer is only a historical review record. Never
    // replace catalogue pricing with a promo lacking a verified live window.
    if (offers.some(r => r.observation.offer?.originalPriceCents !== null &&
        r.observation.offer?.originalPriceCents !== undefined &&
        r.observation.offer.originalPriceCents !== standard[0].observation.currentPriceCents)) {
      conflicts.push({ supermarket: entry.supermarket, productId: entry.productId, reason: 'offer original/catalog disagreement' })
      continue
    }
    const preferred = standard.find(r => r.kind === 'product') ?? standard[0]
    candidateProducts.push({
      supermarket: entry.supermarket, sourceProductId: entry.productId,
      name: preferred.observation.name, observedPriceCents: preferred.observation.currentPriceCents,
      pack: preferred.observation.pack,
      availability: preferred.observation.availability,
      provenance: preferred.observation.provenance,
      freshness: standard.every(r => r.freshness === 'fresh') ? 'fresh' : 'stale',
      // A scraper observation is not proof of rights or a checkout basket.
      authorizedForProduction: false, publicSavingsClaimEligible: false,
    })
  }
  candidateProducts.sort((a,b) => (a.supermarket + ':' + a.sourceProductId).localeCompare(b.supermarket + ':' + b.sourceProductId))
  return {
    schemaVersion: 1, datasetType: 'supa-retailer-offline-reviewed-adapter-extraction',
    capturedFrom: 'existing reviewed local snapshots only',
    permissionGate: 'required-before-live-ingestion', productionEnabled: false,
    publicSavingsClaimEligible: false, snapshotMaxAgeHours: 24,
    snapshots, records, candidateProducts, conflicts,
    summary: {
      parsedSources: snapshots.length, parsedObservations: records.length,
      candidateCount: candidateProducts.length, conflictingProducts: conflicts.length,
      freshSources: snapshots.filter(s => s.freshness === 'fresh').length,
      staleSources: snapshots.filter(s => s.freshness === 'stale').length,
    },
  }
}

async function requirePhysicalRegularFile(path) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FIXTURE_BYTES) fail('input must be an ordinary bounded local file')
}
async function refuseSymlinkParents(path) {
  let current = resolve(path)
  // Refuse any existing symlinked component, even for the private output.
  for (;;) {
    try {
      const s = await lstat(current)
      if (s.isSymbolicLink()) fail('symlink in source or destination path')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}
export async function loadOfflineRetailerEvidence(dir) {
  if (typeof dir !== 'string' || !dir.trim()) fail('missing input directory')
  await refuseSymlinkParents(dir)
  const files = {}
  for (const spec of RETAILER_SOURCES) {
    const filename = resolve(dir, spec.file)
    await refuseSymlinkParents(filename)
    await requirePhysicalRegularFile(filename)
    const body = await readFile(filename, 'utf8')
    try {
      files[spec.key] = JSON.parse(body)
    } catch {
      fail('invalid JSON evidence for ' + spec.key)
    }
  }
  return files
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--out' ||
      !argv[1] || !argv[3] || argv[1].startsWith('-') || argv[3].startsWith('-')) {
    fail('usage: --input <local-reviewed-m1-dir> --out <new-private-dataset.json>')
  }
  const inputDir = resolve(argv[1])
  const outputPath = resolve(argv[3])
  if (outputPath === inputDir || outputPath.startsWith(inputDir + sep)) {
    fail('output must not be inside the input evidence directory')
  }
  await refuseSymlinkParents(outputPath)
  const evidence = await loadOfflineRetailerEvidence(inputDir)
  const report = buildOfflineRetailerDataset(evidence)
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
  await refuseSymlinkParents(outputPath)
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ pathWritten: true, ...report.summary, productionEnabled: false }))
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Offline retailer extraction refused; no verified production prices published')
    process.exitCode = 1
  })
}
