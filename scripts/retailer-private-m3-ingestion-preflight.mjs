/**
 * Product-core: a single OFFLINE M3 admission command for the six existing
 * reviewed PLUS/DekaMarkt capture shapes. This composes, rather than weakens,
 * the canonical adapter, normalized catalog, source-rights, health and
 * historical offer-baseline controls.
 *
 * Only aggregates leave this operator command. Nothing here fetches a URL,
 * licenses a retailer source, publishes a price or proves basket savings.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'
import { planPrivateRetailerRollout } from './retailer-private-source-rollout-matrix.mjs'
import { reviewPrivateRetailerOffers } from './qa-retailer-offer-baseline-corroboration.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const refuse = () => { throw new Error('Private M3 integrated retailer preflight refused') }
const isCount = value => Number.isSafeInteger(value) && value >= 0

/**
 * This API accepts ONLY already reviewed data (not arbitrary HTML or browser
 * responses) and the independent canonical source permission register.
 * The clock is the private audit clock, never the date of a live quote.
 */
export function assessPrivateM3RetailerIngestion(permissionGate, batch, {
  referenceTime = new Date().toISOString(),
} = {}) {
  // The offer-audit clock admits UTC with at most millisecond precision;
  // reject other formats instead of silently rounding nanoseconds.
  if (typeof referenceTime !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(referenceTime)) refuse()
  const rollout = planPrivateRetailerRollout(permissionGate, batch, {
    referenceTime, maxAgeHours: 24,
  })
  const catalog = buildUniversalRetailerCatalog(batch)
  const offers = reviewPrivateRetailerOffers(batch, {
    asOf: referenceTime, windowHours: 24,
  })
  if (rollout.expectedShapeCount !== 6 || rollout.retailerCount !== 2 ||
      rollout.retailers.length !== 2 ||
      rollout.historicalAcceptedShapes > rollout.expectedShapeCount ||
      catalog.sourceCount !== batch.results.length ||
      !isCount(catalog.productCount) ||
      !isCount(catalog.conflictCount) ||
      !isCount(catalog.captureCount) ||
      catalog.captureCount > batch.summary.observations ||
      offers.sourceKinds !== 6 ||
      offers.reviewedObservations !== batch.summary.observations ||
      !isCount(offers.observedOfferRows) ||
      !isCount(offers.corroboratedHistoricalBaselines) ||
      offers.corroboratedHistoricalBaselines > offers.observedOfferRows ||
      rollout.productionEnabled !== false ||
      rollout.publicSavingsClaimEligible !== false ||
      offers.productionEnabled !== false ||
      offers.publicSavingsClaimEligible !== false ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false) refuse()

  // Unresolved is a first-class status, not a fabricated zero-price bargain.
  // An offer can have a valid reviewed baseline yet still have unknown campaign
  // timing or require retailer rights and a genuine human basket observation.
  const uncorroboratedOffers = offers.observedOfferRows -
    offers.corroboratedHistoricalBaselines
  const actions = [
    ...(rollout.missingHistoricalShapeCount > 0
      ? ['review-missing-adapter-shapes'] : []),
    ...(rollout.staleHistoricalCaptures > 0
      ? ['collect-permitted-replacement-snapshots-after-review'] : []),
    ...(catalog.conflictCount > 0
      ? ['resolve-conflicting-archived-product-facts'] : []),
    ...(uncorroboratedOffers > 0
      ? ['review-unverified-historical-offer-baselines'] : []),
    'obtain-written-retailer-reuse-rights',
    'collect-real-11-plus-and-11-dekamarkt-same-context-basket',
    'pin-actual-main-revision-and-verify-trusted-runner',
  ]

  return {
    schemaVersion: 1,
    mode: 'private-m3-integrated-ingestion-preflight',
    evidence: 'reviewed-historical-fixtures-only',
    reviewedAt: referenceTime,
    acceptedSourceShapes: rollout.historicalAcceptedShapes,
    requiredSourceShapes: rollout.expectedShapeCount,
    missingSourceShapes: rollout.missingHistoricalShapeCount,
    staleHistoricalSources: rollout.staleHistoricalCaptures,
    acceptedHistoricalObservations: batch.summary.observations,
    normalizedPrivateProducts: catalog.productCount,
    conflictingPrivateProducts: catalog.conflictCount,
    archivedOfferRows: offers.observedOfferRows,
    corroboratedHistoricalOfferBaselines: offers.corroboratedHistoricalBaselines,
    uncorroboratedHistoricalOfferRows: uncorroboratedOffers,
    unknownOfferWindows: offers.unknownOfferWindows,
    invalidDiscountClaims: offers.invalidDiscountClaims,
    unavailableCurrentPriceCoverage: true,
    completeHistoricalSourceShapeCoverage:
      rollout.historicalAcceptedShapes === rollout.expectedShapeCount &&
      rollout.missingHistoricalShapeCount === 0,
    operatorActions: actions,
    requiresHumanReview: true,
    requiresWrittenReuseRights: true,
    requiresGenuineM3FieldEvidence: true,
    technicalFixtureOnly: true,
    liveRequests: 0,
    permissionVerified: false,
    productionEnabled: false,
    livePricesAvailable: false,
    publicSavingsClaimEligible: false,
    releaseDecision: 'hold',
  }
}

function checkedCliArgs(argv) {
  if (!Array.isArray(argv) || nodeTypes.isProxy(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) refuse()
  const descriptors = Object.getOwnPropertyDescriptors(argv)
  const length = descriptors.length?.value
  if (length === 0 && Reflect.ownKeys(descriptors).length === 1) {
    return new Date().toISOString()
  }
  if (length !== 2 || Reflect.ownKeys(descriptors).length !== 3 ||
      !Object.hasOwn(descriptors[0] ?? {}, 'value') ||
      !Object.hasOwn(descriptors[1] ?? {}, 'value') ||
      descriptors[0].value !== '--at' ||
      typeof descriptors[1].value !== 'string') refuse()
  return descriptors[1].value
}

/** Only embedded reviewed M1 data and canonical source-rights file; NO HTTP. */
export async function main(argv = process.argv.slice(2),
  write = text => process.stdout.write(text)) {
  const referenceTime = checkedCliArgs(argv)
  const permissionGate = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  const report = assessPrivateM3RetailerIngestion(permissionGate, batch, {
    referenceTime,
  })
  write(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private M3 integrated retailer preflight refused')
    process.exitCode = 2
  })
}
