/**
 * Independent OFFLINE QA: how much independent source coverage supports each
 * unverified retailer-pairing candidate? Never labels pairs equivalent and
 * never publishes prices, IDs, permission or savings.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { proposePrivateCrossRetailerMatches } from './retailer-private-cross-store-pairing.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'

const fail = () => { throw new Error('Private retailer cross-store source coverage QA refused') }
const kindAllowed = new Set(['product','catalog','offers'])
function utcMs(value, asOf) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) fail()
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || ms > asOf ||
      new Date(ms).toISOString().slice(0,19) !== value.slice(0,19)) fail()
  return ms
}
function captureCoverage(product, auditTime) {
  const kinds = new Set()
  const times = []
  for (const capture of product.captures) {
    if (!kindAllowed.has(capture.sourceKind)) fail()
    kinds.add(capture.sourceKind)
    times.push(utcMs(capture.capturedAt, auditTime))
  }
  return { kinds, times }
}
/**
 * All outputs are counts only. Human review is still mandatory even when both
 * stores have >=2 kinds of historical provenance and synchronized snapshots.
 */
export function auditPrivateCrossStoreEvidence(catalog, {
  asOf = new Date().toISOString(),
  maxCrossStoreSkewHours = 24,
  maxAgeHours = 24,
} = {}) {
  const clock = utcMs(asOf, Date.now())
  if (!Number.isSafeInteger(maxCrossStoreSkewHours) ||
      maxCrossStoreSkewHours < 1 || maxCrossStoreSkewHours > 720 ||
      !Number.isSafeInteger(maxAgeHours) ||
      maxAgeHours < 1 || maxAgeHours > 720) fail()
  let proposed
  try { proposed = proposePrivateCrossRetailerMatches(catalog) }
  catch { fail() }
  if (proposed.permissionVerified !== false ||
      proposed.publicSavingsClaimEligible !== false ||
      proposed.productionEnabled !== false ||
      proposed.priceComparisonsAvailable !== false) fail()

  const byKey = new Map(catalog.products.map(p => [p.canonicalKey, p]))
  if (byKey.size !== catalog.products.length) fail()
  const result = {
    schemaVersion: 1,
    mode: 'offline-cross-store-pairing-source-coverage-qa',
    candidatePairs: proposed.candidateCount,
    insufficientIndependentKinds: 0,
    misalignedCaptureWindows: 0,
    historicallyMultiSourceSupported: 0,
    staleRelativeToReviewClock: 0,
    withinHistoricalReviewClock: 0,
    maxCrossStoreSkewHours,
    maxAgeHours,
    humanReviewRequired: true,
    verifiedEquivalentProducts: 0,
    verifiedPriceComparisons: 0,
    permissionVerified: false,
    productionEnabled: false,
    livePricesAvailable: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  }
  for (const candidate of proposed.candidatePairs) {
    if (candidate.status !== 'human-review-required' ||
        candidate.verifiedEquivalent !== false ||
        candidate.verifiedPriceMatch !== false ||
        candidate.priceComparisonCents !== null) fail()
    const plus = byKey.get(candidate.plusProductKey)
    const deka = byKey.get(candidate.dekamarktProductKey)
    if (!plus || !deka || plus.retailerId !== 'plus' ||
        deka.retailerId !== 'dekamarkt') fail()
    const p = captureCoverage(plus, clock)
    const d = captureCoverage(deka, clock)
    if (p.kinds.size < 2 || d.kinds.size < 2) {
      result.insufficientIndependentKinds++
      continue
    }
    const times = [...p.times, ...d.times]
    const span = Math.max(...times) - Math.min(...times)
    if (span > maxCrossStoreSkewHours * 3600 * 1000) {
      result.misalignedCaptureWindows++
      continue
    }
    result.historicallyMultiSourceSupported++
    if (times.some(time => clock - time > maxAgeHours * 3600 * 1000)) {
      result.staleRelativeToReviewClock++
    } else {
      result.withinHistoricalReviewClock++
    }
  }
  if (result.insufficientIndependentKinds + result.misalignedCaptureWindows +
      result.historicallyMultiSourceSupported !== result.candidatePairs ||
      result.staleRelativeToReviewClock +
      result.withinHistoricalReviewClock !== result.historicallyMultiSourceSupported) fail()
  return result
}
export async function main(argv = process.argv.slice(2), emit = value => process.stdout.write(value)) {
  if (!Array.isArray(argv) || argv.length !== 0) fail()
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  const report = auditPrivateCrossStoreEvidence(catalog)
  emit(JSON.stringify(report) + '\n')
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer cross-store source coverage QA refused')
    process.exitCode = 2
  })
}
