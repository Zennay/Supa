/**
 * Review-only rollout matrix for the existing PLUS and DekaMarkt six-shape
 * adapters. Integrates REAL, versioned historical repository evidence with
 * the canonical M1 permission gate and private per-shape health evaluator.
 *
 * It never schedules, fetches, proxies, republishes a price or upgrades an
 * archival capture to current/live just because a test passes.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { evaluateSourcePermissionGate } from './m1-check-source-permission-gate.mjs'
import { evaluatePrivateAdapterHealth } from './retailer-private-adapter-health.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const SHAPES = ['product', 'catalog', 'offers']
const RETAILERS = ['plus', 'dekamarkt']
const fail = () => { throw new Error('Private source rollout matrix refused') }

// Adapter health already validated civil timestamp grammar and chronology.
// Compare the full 1–9 fractional digits, not rounded Date.parse milliseconds,
// so archived captures only nanoseconds apart still have the correct ordering.
function captureNanos(iso) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) fail()
  const fractional = /\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$/.exec(iso)?.[1] ?? ''
  return BigInt(ms) * 1_000_000n +
    BigInt(fractional.padEnd(9, '0').slice(3) || '0')
}

/**
 * Convert actual offline health + reviewed source-rights evidence into an
 * operator-readable per-retailer action queue. Never enable live fetch.
 * @param {object} permissionGate the canonical reviewed M1 source rights file
 * @param {object} batch result of ingestReviewedBatch()
 */
export function planPrivateRetailerRollout(permissionGate, batch, {
  referenceTime = new Date().toISOString(), maxAgeHours = 24,
} = {}) {
  // Independent canonical validators: malformed/dishonest counts, timestamps
  // or source rights cannot yield a successful recommendation-shaped report.
  const rights = evaluateSourcePermissionGate(permissionGate)
  const health = evaluatePrivateAdapterHealth(batch, { referenceTime, maxAgeHours })
  if (!Array.isArray(permissionGate.sources) ||
      health.humanReviewRequired !== true ||
      health.permissionVerified !== false ||
      health.productionEnabled !== false ||
      health.publicSavingsClaimEligible !== false ||
      health.externalRequests !== 0) fail()

  // A complete six-shape archive may still contain incompatible facts for the
  // same product. Reconcile against the canonical catalog and route review to
  // the affected retailer only; never mistake source coverage for consistency.
  const accepted = batch.results.filter(result => result.accepted === true)
  const catalog = accepted.length
    ? buildUniversalRetailerCatalog({
      summary: { mode: 'reviewed-offline-only' }, results: accepted,
    })
    : null
  if ((catalog?.conflictCount ?? 0) !== health.inconsistentProducts) fail()
  const conflictRetailers = new Set((catalog?.products ?? [])
    .filter(product => product.consistency !== 'consistent')
    .map(product => product.retailerId))
  if ([...conflictRetailers].some(id => !RETAILERS.includes(id)) ||
      health.operatorActions.includes('review-conflicting-product-facts') !==
        (conflictRetailers.size > 0)) fail()
  // Publish review workload *counts*, never product identifiers, prices or
  // capture hashes. Catalog consistency is already canonical and reviewed.
  const conflictCounts = Object.fromEntries(RETAILERS.map(id => [id, 0]))
  for (const product of catalog?.products ?? []) {
    if (!RETAILERS.includes(product.retailerId)) fail()
    if (product.consistency !== 'consistent') {
      conflictCounts[product.retailerId]++
    }
  }
  if (RETAILERS.reduce((sum, id) => sum + conflictCounts[id], 0) !==
      (catalog?.conflictCount ?? 0)) fail()

  const retailers = RETAILERS.map(retailerId => {
    const source = permissionGate.sources.find(row => row.supermarket === retailerId)
    const rightsBlocked = source?.permissionStatus !== 'permitted' ||
      source?.productionEnabled !== true
    const kinds = SHAPES.map(kind => {
      const key = retailerId + ':' + kind
      const bucket = health.byShape[key]
      if (!bucket || bucket.sources !== bucket.accepted + bucket.rejected) fail()
      // The health gate has already validated every admitted provenance. Show
      // the newest *archived* timestamp so an operator can see which exact
      // captured snapshot the historical status refers to. Not a fresh price.
      const capturedAt = batch.results
        .filter(result => result.key === key && result.accepted === true)
        .map(result => result.observations[0].provenance.capturedAt)
        .sort((left, right) => {
          const a = captureNanos(left), b = captureNanos(right)
          return a === b ? 0 : a > b ? -1 : 1
        })[0] ?? null
      const status = bucket.accepted === 0
        ? 'no-accepted-historical-capture'
        : bucket.rejected > 0
          ? 'rejected-historical-input-needs-review'
          : bucket.staleCaptures > 0
            ? 'archived-capture-outside-review-window'
            : 'historical-fixture-present'
      return {
        kind, status,
        historicalSources: bucket.sources,
        acceptedSources: bucket.accepted,
        rejectedSources: bucket.rejected,
        historicalObservations: bucket.observations,
        staleHistoricalCaptures: bucket.staleCaptures,
        latestArchivedCapturedAt: capturedAt,
        unknownPriceObservations: bucket.unknownPrices,
        verifiedCurrentPriceObservations: 0,
        eligibleForLiveCapture: false,
      }
    })
    const actions = [
      ...(rightsBlocked ? ['obtain-and-verify-retailer-source-rights'] : []),
      ...(kinds.some(k => k.acceptedSources === 0)
        ? ['review-missing-offline-source-shapes'] : []),
      ...(kinds.some(k => k.rejectedSources > 0)
        ? ['review-rejected-adapter-evidence'] : []),
      ...(kinds.some(k => k.staleHistoricalCaptures > 0)
        ? ['review-historical-capture-freshness'] : []),
      ...(conflictRetailers.has(retailerId)
        ? ['review-conflicting-product-facts'] : []),
      'validate-new-captures-offline-before-separate-release-approval',
    ]
    return {
      retailerId,
      permissionStatus: source.permissionStatus,
      sourceRightsReadyForProduction: !rightsBlocked,
      technicalAdapterShapeCount: SHAPES.length,
      acceptedHistoricalShapes: kinds.filter(k => k.acceptedSources > 0).length,
      historicalConflictingProductCount: conflictCounts[retailerId],
      shapes: kinds,
      nextActions: actions,
      liveScrapingEnabled: false,
      scheduledRefreshEnabled: false,
      currentPricePublicationAllowed: false,
    }
  })
  return {
    schemaVersion: 1,
    mode: 'private-retailer-rollout-matrix',
    context: 'reviewed-historical-captures-not-live-prices',
    referenceTime, maxAgeHours,
    retailerCount: retailers.length,
    expectedShapeCount: RETAILERS.length * SHAPES.length,
    historicalAcceptedShapes: retailers.reduce((sum, row) =>
      sum + row.acceptedHistoricalShapes, 0),
    historicalConflictingProductCount: catalog?.conflictCount ?? 0,
    staleHistoricalCaptures: health.staleSources,
    missingHistoricalShapeCount: health.missingSourceKinds.length,
    rightsGateProductionReady: rights.productionReady,
    retailers,
    requiresHumanReview: true,
    permissionVerifiedForNewCapture: false,
    liveRetailerRequests: 0,
    liveScrapingEnabled: false,
    scheduledRefreshEnabled: false,
    publicSavingsClaimEligible: false,
    productionEnabled: false,
  }
}

/** Actual bundled historical six-adapter run. Never accepts a source URL/path. */
export async function main(argv = process.argv.slice(2),
  write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) ||
      !(argv.length === 0 ||
        (argv.length === 2 && argv[0] === '--at' &&
          typeof argv[1] === 'string' &&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(argv[1])))) fail()
  const referenceTime = argv.length === 2 ? argv[1] : new Date().toISOString()
  const gate = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  const summary = planPrivateRetailerRollout(gate, batch, { referenceTime })
  // Aggregates only. Deliberately exclude source URLs, SHAs, product identities
  // and price/offer amounts from shared logs.
  write(JSON.stringify(summary, null, 2) + '\n')
  return summary
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private source rollout matrix refused')
    process.exitCode = 2
  })
}
