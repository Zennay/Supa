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
import { loadPrivateReviewedCaptureBatch } from './retailer-private-reviewed-manifest-replay.mjs'

const refuse = () => { throw new Error('Private M3 integrated retailer preflight refused') }
const isCount = value => Number.isSafeInteger(value) && value >= 0

/**
 * This API accepts ONLY already reviewed data (not arbitrary HTML or browser
 * responses) and the independent canonical source permission register.
 * The clock is the private audit clock, never the date of a live quote.
 */
function inertPreflightOptions(options) {
  // Programmatic JS callers must not be able to trigger inherited/getter/Proxy
  // code merely by requesting an offline audit. Only own inert data is read.
  if (options === null || typeof options !== 'object' ||
      Array.isArray(options) || nodeTypes.isProxy(options)) refuse()
  const proto = Object.getPrototypeOf(options)
  if (proto !== Object.prototype && proto !== null) refuse()
  const descriptors = Object.getOwnPropertyDescriptors(options)
  if (Reflect.ownKeys(descriptors).some(key =>
    typeof key !== 'string' ||
    !['referenceTime', 'inputMode'].includes(key) ||
    !Object.hasOwn(descriptors[key], 'value'))) refuse()
  const referenceTime = Object.hasOwn(descriptors, 'referenceTime')
    ? descriptors.referenceTime.value : new Date().toISOString()
  const inputMode = Object.hasOwn(descriptors, 'inputMode')
    ? descriptors.inputMode.value : 'reviewed-in-memory-batch'
  if (!['reviewed-in-memory-batch', 'bundled-historical-fixtures',
    'operator-private-manifest'].includes(inputMode)) refuse()
  return { referenceTime, inputMode }
}

export function assessPrivateM3RetailerIngestion(permissionGate, batch, options = {}) {
  const { referenceTime, inputMode } = inertPreflightOptions(options)
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

  // Six shape-level diagnostics are explicitly public-safe aggregates. They
  // identify the retailer/source TYPE needing offline review without revealing
  // any captured URL, digest, SKU, product name or price.
  const shapeDiagnostics = rollout.retailers.flatMap(retailer =>
    retailer.shapes.map(shape => ({
      retailer: retailer.retailerId,
      kind: shape.kind,
      historicalStatus: shape.status,
      acceptedHistoricalSources: shape.acceptedSources,
      rejectedHistoricalSources: shape.rejectedSources,
      archivedObservations: shape.historicalObservations,
      staleHistoricalSources: shape.staleHistoricalCaptures,
      unknownHistoricalPrices: shape.unknownPriceObservations,
      verifiedCurrentPriceObservations: 0,
    })))
  if (shapeDiagnostics.length !== 6 ||
      new Set(shapeDiagnostics.map(row => row.retailer + ':' + row.kind)).size !== 6 ||
      shapeDiagnostics.some(row =>
        !isCount(row.acceptedHistoricalSources) ||
        !isCount(row.rejectedHistoricalSources) ||
        !isCount(row.archivedObservations) ||
        !isCount(row.staleHistoricalSources) ||
        !isCount(row.unknownHistoricalPrices)) ||
      shapeDiagnostics.reduce((sum, row) => sum + row.archivedObservations, 0) !==
        batch.summary.observations) refuse()

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
    evidence: 'reviewed-historical-captures-only',
    inputMode,
    reviewedAt: referenceTime,
    acceptedSourceShapes: rollout.historicalAcceptedShapes,
    requiredSourceShapes: rollout.expectedShapeCount,
    missingSourceShapes: rollout.missingHistoricalShapeCount,
    staleHistoricalSources: rollout.staleHistoricalCaptures,
    acceptedHistoricalObservations: batch.summary.observations,
    perSourceShape: shapeDiagnostics,
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
    historicalReviewedOnly: true,
    operatorSuppliedPrivateSources: inputMode === 'operator-private-manifest',
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
  const desc = Object.getOwnPropertyDescriptors(argv)
  const length = desc.length?.value
  if (![0, 2, 4].includes(length) ||
      Reflect.ownKeys(desc).length !== length + 1) refuse()
  const args = []
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(desc[index] ?? {}, 'value') ||
        typeof desc[index].value !== 'string') refuse()
    args.push(desc[index].value)
  }
  if (length === 0) return {
    referenceTime: new Date().toISOString(), directory: null,
  }
  if (length === 2 && args[0] === '--at') return {
    referenceTime: args[1], directory: null,
  }
  if ((length === 2 || length === 4) && args[0] === '--dir' &&
      (length === 2 || args[2] === '--at') &&
      args[1].trim() && args[1].length <= 500 && !args[1].startsWith('-')) {
    return {
      referenceTime: length === 4 ? args[3] : new Date().toISOString(),
      directory: args[1],
    }
  }
  refuse()
}

/**
 * Default: bundled six M1 snapshots. --dir: *already reviewed*, SHA-pinned
 * immutable 0600 manifest/sources loaded with the existing descriptor-safe,
 * nofollow private manifest verifier. Reads only; never creates a manifest,
 * writes a file, runs an HTTP request, or emits individual product/price facts.
 */
export async function main(argv = process.argv.slice(2),
  write = text => process.stdout.write(text)) {
  const { referenceTime, directory } = checkedCliArgs(argv)
  const permissionGate = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  let batch
  if (directory === null) {
    batch = await loadReviewedRepositoryFixtures()
  } else {
    // This integrated baseline audit requires one source event for each
    // of six shapes. Do not silently drop older or additional captures.
    try {
      batch = await loadPrivateReviewedCaptureBatch(directory, { referenceTime })
      if (batch.results.length !== 6 || batch.summary.sources !== 6) refuse()
    } catch { refuse() }
  }
  const report = assessPrivateM3RetailerIngestion(permissionGate, batch, {
    referenceTime,
    inputMode: directory === null
      ? 'bundled-historical-fixtures' : 'operator-private-manifest',
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
