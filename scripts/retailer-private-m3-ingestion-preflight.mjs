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

const SHAPES = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']

/**
 * Review the latest PHYSICAL archived event in each of six channel shapes.
 * The complete 6..32 source history still enters health and catalog drift.
 * Older offer rows must remain counted as NOT COMPARED; no source is secretly
 * promoted to live/current and no past evidence is discarded from the catalog.
 */
function chooseOneHistoricalCapturePerShape(batch) {
  if (!batch || !Array.isArray(batch.results) ||
      batch.results.length < 6 || batch.results.length > 32) refuse()
  const latest = new Map()
  let allOfferRows = 0
  for (const result of batch.results) {
    if (!result || !SHAPES.includes(result.key) ||
        result.accepted !== true ||
        !Array.isArray(result.observations) ||
        result.observations.length === 0) refuse()
    if (result.key.endsWith(':offers')) allOfferRows += result.observations.length
    const time = result.observations[0]?.provenance?.capturedAt
    if (typeof time !== 'string') refuse()
    // The preceding canonical rollout/health pass checked the full ISO civil
    // grammar, ±14h offsets, physical chronology and every source event.
    const ms = Date.parse(time)
    const fraction = /\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$/.exec(time)?.[1] ?? ''
    if (!Number.isFinite(ms)) refuse()
    const nanos = BigInt(ms) * 1_000_000n +
      BigInt(fraction.padEnd(9, '0').slice(3) || '0')
    const old = latest.get(result.key)
    // Never choose arbitrarily between two distinct events claiming the same
    // physical timestamp for the same retailer and source kind.
    if (old && old.nanos === nanos) refuse()
    if (!old || nanos > old.nanos) latest.set(result.key, { result, nanos })
  }
  if (latest.size !== SHAPES.length) refuse()
  const results = SHAPES.map(key => latest.get(key).result)
  const observations = results.reduce((n, row) => n + row.observations.length, 0)
  const retailerCounts = { plus: 0, dekamarkt: 0 }
  for (const row of results) {
    const retailer = row.key.split(':')[0]
    retailerCounts[retailer] += row.observations.length
  }
  const reviewedOfferRows = results.filter(row => row.key.endsWith(':offers'))
    .reduce((n, row) => n + row.observations.length, 0)
  const selected = {
    summary: {
      mode: 'reviewed-offline-only', sources: 6,
      acceptedSources: 6, rejectedSources: 0,
      observations, retailerCounts,
      productionEnabled: false, permissionVerified: false,
      publicSavingsClaimEligible: false,
    },
    results,
  }
  return {
    selected, reviewedOfferRows, allOfferRows,
    historicalSourceEventsOutsideOfferReview: batch.results.length - SHAPES.length,
  }
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
  const selection = chooseOneHistoricalCapturePerShape(batch)
  const offers = reviewPrivateRetailerOffers(selection.selected, {
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
      offers.reviewedObservations !== selection.selected.summary.observations ||
      offers.observedOfferRows !== selection.reviewedOfferRows ||
      selection.allOfferRows < selection.reviewedOfferRows ||
      !isCount(offers.observedOfferRows) ||
      !isCount(offers.corroboratedHistoricalBaselines) ||
      offers.corroboratedHistoricalBaselines > offers.observedOfferRows ||
      rollout.productionEnabled !== false ||
      rollout.publicSavingsClaimEligible !== false ||
      offers.productionEnabled !== false ||
      offers.publicSavingsClaimEligible !== false ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false) refuse()

  // Canonical health has already validated every accepted observation, but
  // its rollout projection does not expose source-stock uncertainty. Keep
  // the three mutually exclusive observed states separate: UNKNOWN stock is
  // never treated as purchasable, even for an apparently valid price/pack.
  // This is *archived* evidence, not a real-time availability promise.
  const stockByShape = new Map(SHAPES.map(key => [key, {
    unknown: 0, unavailable: 0, available: 0,
  }]))
  for (const result of batch.results) {
    const stock = stockByShape.get(result.key)
    if (!stock || result.accepted !== true ||
        !Array.isArray(result.observations)) refuse()
    for (const observation of result.observations) {
      if (observation.availability === 'unknown') stock.unknown++
      else if (observation.availability === 'unavailable') stock.unavailable++
      else if (observation.availability === 'available') stock.available++
      else refuse()
    }
  }

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
      // A retailer capture can carry a valid historical price while stock
      // is unknown or explicitly unavailable. None is a checkout claim.
      unknownHistoricalAvailability:
        stockByShape.get(retailer.retailerId + ':' + shape.kind).unknown,
      unavailableHistoricalObservations:
        stockByShape.get(retailer.retailerId + ':' + shape.kind).unavailable,
      availableHistoricalObservations:
        stockByShape.get(retailer.retailerId + ':' + shape.kind).available,
      latestArchivedCapturedAt: shape.latestArchivedCapturedAt,
      verifiedCurrentPriceObservations: 0,
    })))
  if (shapeDiagnostics.length !== 6 ||
      new Set(shapeDiagnostics.map(row => row.retailer + ':' + row.kind)).size !== 6 ||
      shapeDiagnostics.some(row =>
        !isCount(row.acceptedHistoricalSources) ||
        !isCount(row.rejectedHistoricalSources) ||
        !isCount(row.archivedObservations) ||
        !isCount(row.staleHistoricalSources) ||
        !isCount(row.unknownHistoricalPrices) ||
        !isCount(row.unknownHistoricalAvailability) ||
        !isCount(row.unavailableHistoricalObservations) ||
        !isCount(row.availableHistoricalObservations) ||
        row.unknownHistoricalAvailability +
          row.unavailableHistoricalObservations +
          row.availableHistoricalObservations !== row.archivedObservations) ||
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
    ...(selection.historicalSourceEventsOutsideOfferReview > 0
      ? ['review-additional-archived-source-events-outside-offer-comparison'] : []),
    ...(shapeDiagnostics.some(row => row.unknownHistoricalAvailability > 0)
      ? ['review-unknown-historical-retailer-stock'] : []),
    ...(shapeDiagnostics.some(row => row.unavailableHistoricalObservations > 0)
      ? ['review-unavailable-historical-retailer-stock'] : []),
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
    historicalStockUnknownObservations: shapeDiagnostics.reduce((sum, row) =>
      sum + row.unknownHistoricalAvailability, 0),
    historicalStockUnavailableObservations: shapeDiagnostics.reduce((sum, row) =>
      sum + row.unavailableHistoricalObservations, 0),
    historicalStockAvailableObservations: shapeDiagnostics.reduce((sum, row) =>
      sum + row.availableHistoricalObservations, 0),
    // Archived stock counts must not be interpreted as current purchasability.
    currentStockCoverageVerified: false,
    perSourceShape: shapeDiagnostics,
    normalizedPrivateProducts: catalog.productCount,
    conflictingPrivateProducts: catalog.conflictCount,
    // The full history enters quality/drift checks. Only the latest of each
    // of six source kinds enters one conservative offer-baseline comparison.
    historicalSourceEvents: batch.results.length,
    selectedSourceEventsForOfferReview: 6,
    sourceEventsOutsideOfferReview: selection.historicalSourceEventsOutsideOfferReview,
    offerReviewSelectionPolicy: 'latest-physical-capture-per-retailer-kind',
    allHistoricalOfferRows: selection.allOfferRows,
    olderHistoricalOfferRowsNotCompared:
      selection.allOfferRows - selection.reviewedOfferRows,
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
    // The existing verifier admits 6–32 SHA-pinned reviewed capture events.
    // The complete history remains in quality/drift, with only the latest
    // per shape used for conservative *historical* offer corroboration.
    try {
      batch = await loadPrivateReviewedCaptureBatch(directory, { referenceTime })
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
