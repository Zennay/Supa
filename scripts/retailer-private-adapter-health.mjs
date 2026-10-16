/**
 * Read-only operational health over *already reviewed* six-adapter results.
 * Counts represent the supplied offline dataset, not live retail coverage.
 * No network, source URL, product name, price or SHA reaches the report.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { snapshotBoundedPrivateCatalogInput,
  buildBudgetedPrivateRetailerCatalog } from './retailer-private-budgeted-catalog.mjs'

const STORES = ['plus', 'dekamarkt']
const KINDS = ['product', 'catalog', 'offers']
const PAIRS = STORES.flatMap(store => KINDS.map(kind => store + ':' + kind))
const fail = () => { throw new Error('Private retailer adapter health review refused') }
const safeCount = value => Number.isSafeInteger(value) && value >= 0
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
// Match the existing PLUS/Deka adapter's safeCapturedAt grammar. Real
// reviewed sources may use a UTC offset, minute precision or up to nine
// fractional digits; Date.parse normalizes those to an absolute instant.
const timestamp = value => {
  if (typeof value !== 'string') fail()
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts) fail()
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3])
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day ||
      Number(parts[4]) > 23 || Number(parts[5]) > 59 ||
      Number(parts[6] ?? 0) > 59) fail()
  const timezone = parts[8]
  if (timezone !== 'Z') {
    const [hours, minutes] = timezone.slice(1).split(':').map(Number)
    // Real civil UTC offsets cannot exceed ±14:00.
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) fail()
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) fail()
  // Date.parse truncates below one millisecond. Preserve all 1-9 digits
  // so a +1ns future capture cannot be admitted as current/historical.
  // The first three fractional digits are already included in parsed ms.
  const fractional = (parts[7] ?? '').padEnd(9, '0')
  const subMillisecond = BigInt(fractional.slice(3) || '0')
  return BigInt(ms) * 1_000_000n + subMillisecond
}
const emptyCoverage = () => ({
  sources: 0, accepted: 0, rejected: 0, observations: 0,
  staleCaptures: 0, unknownPrices: 0, unknownAvailability: 0,
  unknownPacks: 0, offerObservations: 0,
})

/**
 * @param {object} batch result of ingestReviewedBatch (not raw retailer HTML)
 * @param {object} options referenceTime is an explicit audit clock, NOT a license
 */
export function evaluatePrivateAdapterHealth(callerBatch, callerOptions = {}) {
  // This is a direct in-process API as well as a CLI. Never inspect caller
  // data or destructure options until the entire graph is detached using
  // own inert descriptors; the snapshot also blocks active/revoked Proxies,
  // getters, inherited values, sparse arrays and excessive primitive bytes.
  // Convert even native reflection failures to the private domain refusal.
  let pinned
  try {
    pinned = snapshotBoundedPrivateCatalogInput({
      batch: callerBatch, options: callerOptions,
    })
  } catch { fail() }
  const { batch, options } = pinned
  if (!isObject(batch) || !isObject(options) ||
      Object.keys(options).some(key =>
        key !== 'referenceTime' && key !== 'maxAgeHours')) fail()
  const { referenceTime = new Date().toISOString(), maxAgeHours = 24 } = options
  const now = timestamp(referenceTime)
  if (!Number.isSafeInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 720 ||
      !isObject(batch) || !isObject(batch.summary) ||
      batch.summary.mode !== 'reviewed-offline-only' ||
      batch.summary.productionEnabled !== false ||
      batch.summary.permissionVerified !== false ||
      batch.summary.publicSavingsClaimEligible !== false ||
      !Array.isArray(batch.results) || batch.results.length < 1 ||
      batch.results.length > 32 || !isObject(batch.summary.retailerCounts)) fail()

  const byShape = Object.fromEntries(PAIRS.map(key => [key, emptyCoverage()]))
  let acceptedSources = 0
  let rejectedSources = 0
  let observations = 0
  const retailerCounts = { plus: 0, dekamarkt: 0 }
  const accepted = []
  const identities = new Set()
  for (let i = 0; i < batch.results.length; i++) {
    if (!Object.hasOwn(batch.results, i)) fail()
    const result = batch.results[i]
    if (!isObject(result) || !PAIRS.includes(result.key) ||
        typeof result.accepted !== 'boolean' ||
        !Array.isArray(result.observations) ||
        (result.accepted ? result.reason !== null ||
          result.observations.length === 0 || result.observations.length > 256
          : typeof result.reason !== 'string' || result.observations.length !== 0)) fail()
    const bucket = byShape[result.key]
    bucket.sources++
    if (!result.accepted) {
      rejectedSources++
      bucket.rejected++
      continue
    }
    acceptedSources++
    bucket.accepted++
    const [retailer, kind] = result.key.split(':')
    const first = result.observations[0]
    const source = first?.provenance
    if (!isObject(source) || source.supermarket !== retailer || source.kind !== kind ||
        typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256) ||
        typeof source.url !== 'string') fail()
    // A different lexical offset can denote the same physical instant.
    // Bind event identity to absolute nanoseconds, not timestamp spelling.
    const when = timestamp(source.capturedAt)
    const event = JSON.stringify([result.key, source.url, source.sha256, when.toString()])
    if (identities.has(event)) fail()
    identities.add(event)
    if (when > now) fail()
    if (now - when > BigInt(maxAgeHours) * 3_600_000_000_000n) bucket.staleCaptures++
    const seenProducts = new Set()
    for (let j = 0; j < result.observations.length; j++) {
      if (!Object.hasOwn(result.observations, j)) fail()
      const observation = result.observations[j]
      try { validateRawProductObservation(observation) } catch { fail() }
      const origin = observation.provenance
      if (observation.supermarket !== retailer || !isObject(origin) ||
          origin.supermarket !== retailer || origin.kind !== kind ||
          origin.sha256 !== source.sha256 || origin.url !== source.url ||
          origin.capturedAt !== source.capturedAt ||
          typeof observation.sourceProductId !== 'string' ||
          seenProducts.has(observation.sourceProductId)) fail()
      seenProducts.add(observation.sourceProductId)
      bucket.observations++
      retailerCounts[retailer]++
      observations++
      if (observation.currentPriceCents === null) bucket.unknownPrices++
      if (observation.availability === 'unknown') bucket.unknownAvailability++
      if (observation.pack?.unit === 'unknown' || observation.pack?.amount === null) bucket.unknownPacks++
      if (observation.offer !== null) bucket.offerObservations++
    }
    accepted.push(result)
  }
  if (batch.summary.sources !== batch.results.length ||
      batch.summary.acceptedSources !== acceptedSources ||
      batch.summary.rejectedSources !== rejectedSources ||
      batch.summary.observations !== observations ||
      !safeCount(batch.summary.retailerCounts.plus) ||
      !safeCount(batch.summary.retailerCounts.dekamarkt) ||
      batch.summary.retailerCounts.plus !== retailerCounts.plus ||
      batch.summary.retailerCounts.dekamarkt !== retailerCounts.dekamarkt) fail()

  // The existing universal product model resolves duplicate captures and
  // identifies fact conflicts, without promoting historical prices to "current".
  const catalog = accepted.length
    ? buildBudgetedPrivateRetailerCatalog({
      summary: { mode: 'reviewed-offline-only' }, results: accepted,
    })
    : null
  const missingSourceKinds = PAIRS.filter(key => byShape[key].accepted === 0)
  const staleSources = PAIRS.reduce((sum, key) => sum + byShape[key].staleCaptures, 0)
  const unknownPriceObservations = PAIRS.reduce((sum, key) => sum + byShape[key].unknownPrices, 0)
  const inconsistentProducts = catalog?.conflictCount ?? 0
  const operatorActions = [
    ...(missingSourceKinds.length ? ['review-missing-source-shapes'] : []),
    ...(rejectedSources ? ['review-rejected-adapter-inputs'] : []),
    ...(staleSources ? ['review-capture-freshness'] : []),
    ...(inconsistentProducts ? ['review-conflicting-product-facts'] : []),
    ...(unknownPriceObservations ? ['review-missing-price-facts'] : []),
    'obtain-written-retailer-source-rights',
    'collect-genuine-two-store-m3-basket-evidence',
  ]
  return {
    schemaVersion: 1,
    mode: 'private-reviewed-adapter-health',
    meaning: 'offline-dataset-only',
    sources: batch.results.length,
    acceptedSources, rejectedSources, observations,
    products: catalog?.productCount ?? 0,
    captureEvents: catalog?.captureCount ?? 0,
    inconsistentProducts, staleSources, unknownPriceObservations,
    maxAgeHours,
    byShape,
    missingSourceKinds,
    sixShapeCoverageComplete: missingSourceKinds.length === 0 && rejectedSources === 0,
    historicalFreshnessWithinWindow: staleSources === 0,
    operatorActions,
    humanReviewRequired: true, permissionVerified: false,
    productionEnabled: false, livePricesAvailable: false,
    publicSavingsClaimEligible: false, externalRequests: 0,
  }
}

export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  // Programmatic callers can pass Proxy arrays whose .length invokes
  // arbitrary getters. The CLI is strictly zero-argument: first pin an
  // inert copy before checking its length or starting fixture IO.
  let pinnedArgs
  try { pinnedArgs = snapshotBoundedPrivateCatalogInput(argv) } catch { fail() }
  if (!Array.isArray(pinnedArgs) || pinnedArgs.length !== 0) fail()
  const batch = await loadReviewedRepositoryFixtures()
  const report = evaluatePrivateAdapterHealth(batch)
  write(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer adapter health review refused')
    process.exitCode = 2
  })
}
