/**
 * Read-only, operator-selected SUPA M3 historical capture drift rehearsal.
 *
 * Two independently SHA-pinned private PLUS/Deka manifest directories are
 * replayed through the same reviewed six-shape engine, source rights and
 * historical offer/stock admission as the actual single-directory preflight.
 * Compare catalog facts only AFTER both sides pass admission. No HTTP,
 * active retailer capture, scheduler, evidence writes or public price claims.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'
import { loadPrivateReviewedCaptureBatch } from './retailer-private-reviewed-manifest-replay.mjs'
import { assessPrivateM3RetailerIngestion } from './retailer-private-m3-ingestion-preflight.mjs'
import { comparePrivateRetailerFactChanges } from './retailer-private-fact-change-review.mjs'

const KEYS = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const fail = () => { throw new Error('Private M3 retailer drift rehearsal refused') }
const safe = n => Number.isSafeInteger(n) && n >= 0
const changeKinds = ['added', 'missing', 'priceChanged', 'offerChanged',
  'packChanged', 'availabilityChanged', 'nameChanged', 'sourceUrlChanged']

function ownOptions(options) {
  if (!options || typeof options !== 'object' ||
      Array.isArray(options) || nodeTypes.isProxy(options)) fail()
  const prototype = Object.getPrototypeOf(options)
  if (prototype !== Object.prototype && prototype !== null) fail()
  const fields = Object.getOwnPropertyDescriptors(options)
  if (Reflect.ownKeys(fields).some(key =>
    key !== 'referenceTime' ||
    !Object.hasOwn(fields[key], 'value'))) fail()
  const referenceTime = Object.hasOwn(fields, 'referenceTime')
    ? fields.referenceTime.value : new Date().toISOString()
  if (typeof referenceTime !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(referenceTime) ||
      !Number.isFinite(Date.parse(referenceTime))) fail()
  return { referenceTime }
}

// Canonical M3 admission independently verifies legal calendar grammar,
// per-source chronology and offsets. Retain physical ns below Date.parse ms.
function physicalNanos(value) {
  if (typeof value !== 'string') fail()
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) fail()
  const fraction = /\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? ''
  return BigInt(ms) * 1_000_000n +
    BigInt(fraction.padEnd(9, '0').slice(3) || '0')
}

/**
 * A physical event at the SAME instant cannot have two unrelated original
 * source identities when the two operator archives claim continuity. A fact
 * comparator that matches only shared product IDs otherwise misses an entire
 * catalog whose ID scheme was replaced at the same physical capture instant.
 */
function eventIdentityAt(batch, key, when) {
  for (const item of batch.results) {
    if (item.key !== key || item.accepted !== true) continue
    const first = item.observations[0]?.provenance
    if (!first || typeof first.sha256 !== 'string' ||
        typeof first.url !== 'string') fail()
    if (physicalNanos(first.capturedAt) === when) {
      return { sha: first.sha256, url: first.url }
    }
  }
  fail()
}

/**
 * Accept only independently canonical already-reviewed in-memory batches.
 * No source URL, SKU, individual price or original SHA leaves this function.
 */
export function rehearsePrivateM3RetailerDrift(permissionGate, previous, current,
  options = {}) {
  const { referenceTime } = ownOptions(options)
  const before = assessPrivateM3RetailerIngestion(permissionGate, previous, {
    referenceTime,
  })
  const after = assessPrivateM3RetailerIngestion(permissionGate, current, {
    referenceTime,
  })
  const facts = comparePrivateRetailerFactChanges(previous, current, {
    referenceTime,
  })
  if (before.releaseDecision !== 'hold' || after.releaseDecision !== 'hold' ||
      before.permissionVerified !== false || after.permissionVerified !== false ||
      !before.completeHistoricalSourceShapeCoverage ||
      !after.completeHistoricalSourceShapeCoverage ||
      before.liveRequests !== 0 || after.liveRequests !== 0 ||
      before.publicSavingsClaimEligible !== false ||
      after.publicSavingsClaimEligible !== false ||
      facts.productionEnabled !== false ||
      facts.publicSavingsClaimEligible !== false ||
      facts.externalRequests !== 0 ||
      !facts.historicalOnly || !facts.humanReviewRequired ||
      !facts.perShape || Object.keys(facts.perShape).length !== 6) fail()

  const previousByKey = new Map(before.perSourceShape.map(row =>
    [row.retailer + ':' + row.kind, row]))
  const currentByKey = new Map(after.perSourceShape.map(row =>
    [row.retailer + ':' + row.kind, row]))
  const alerts = []
  const perShape = KEYS.map(key => {
    const earlier = previousByKey.get(key)
    const later = currentByKey.get(key)
    const diff = facts.perShape[key]
    if (!earlier || !later || !diff ||
        !earlier.latestArchivedCapturedAt || !later.latestArchivedCapturedAt) fail()
    // An entire source kind cannot move BACKWARD in physical archived time,
    // even if its product IDs changed so that the fact diff has no shared SKU.
    const previousInstant = physicalNanos(earlier.latestArchivedCapturedAt)
    const currentInstant = physicalNanos(later.latestArchivedCapturedAt)
    if (currentInstant < previousInstant) fail()
    if (currentInstant === previousInstant) {
      const oldEvent = eventIdentityAt(previous, key, previousInstant)
      const newEvent = eventIdentityAt(current, key, currentInstant)
      if (oldEvent.sha !== newEvent.sha || oldEvent.url !== newEvent.url) fail()
    }
    if (!changeKinds.every(field => safe(diff[field]))) fail()
    const changedFacts = changeKinds.reduce((n, field) => n + diff[field], 0)
    if (!safe(changedFacts) ||
        !safe(earlier.archivedObservations) || !safe(later.archivedObservations) ||
        !safe(later.unknownHistoricalAvailability) ||
        !safe(earlier.unknownHistoricalAvailability) ||
        !safe(later.unavailableHistoricalObservations) ||
        !safe(earlier.unavailableHistoricalObservations) ||
        !safe(later.staleHistoricalSources) ||
        !safe(earlier.staleHistoricalSources)) fail()
    const signals = [
      ...(changedFacts > 0 ? ['review-archived-product-fact-changes'] : []),
      ...(later.unknownHistoricalAvailability >
        earlier.unknownHistoricalAvailability
        ? ['more-unknown-archived-availability'] : []),
      ...(later.unavailableHistoricalObservations >
        earlier.unavailableHistoricalObservations
        ? ['more-unavailable-archived-products'] : []),
      ...(later.staleHistoricalSources > earlier.staleHistoricalSources
        ? ['more-stale-archived-sources'] : []),
      ...(later.rejectedHistoricalSources > earlier.rejectedHistoricalSources
        ? ['more-rejected-reviewed-sources'] : []),
    ]
    if (signals.length) alerts.push({ key, signals })
    return {
      retailer: key.split(':')[0], kind: key.split(':')[1],
      previouslyArchivedAt: earlier.latestArchivedCapturedAt,
      currentlyArchivedAt: later.latestArchivedCapturedAt,
      previousObservations: earlier.archivedObservations,
      reviewedObservations: later.archivedObservations,
      reviewedSourceEvents: later.acceptedHistoricalSources,
      archiveStockUnknownDelta:
        later.unknownHistoricalAvailability - earlier.unknownHistoricalAvailability,
      archiveStockUnavailableDelta:
        later.unavailableHistoricalObservations - earlier.unavailableHistoricalObservations,
      archivedStaleSourceDelta:
        later.staleHistoricalSources - earlier.staleHistoricalSources,
      addedArchivedProducts: diff.added,
      missingArchivedProducts: diff.missing,
      historicalChangedFactFields: changedFacts,
      reviewSignals: signals,
    }
  })
  if (perShape.length !== 6 || previousByKey.size !== 6 ||
      currentByKey.size !== 6 ||
      perShape.reduce((n, row) => n + row.previousObservations, 0) !==
        before.acceptedHistoricalObservations ||
      perShape.reduce((n, row) => n + row.reviewedObservations, 0) !==
        after.acceptedHistoricalObservations) fail()

  return {
    schemaVersion: 1,
    mode: 'private-m3-offline-capture-drift-rehearsal',
    meaning: 'reviewed-historical-evidence-comparison-only',
    reviewedAt: referenceTime,
    historicalSourceShapes: 6,
    beforeArchivedSourceEvents: before.historicalSourceEvents,
    afterArchivedSourceEvents: after.historicalSourceEvents,
    beforeArchivedObservations: before.acceptedHistoricalObservations,
    afterArchivedObservations: after.acceptedHistoricalObservations,
    beforeArchivedProducts: before.normalizedPrivateProducts,
    afterArchivedProducts: after.normalizedPrivateProducts,
    archivedChangedFactFields: perShape.reduce((n, row) =>
      n + row.historicalChangedFactFields, 0),
    perShape,
    alertShapeCount: alerts.length,
    operatorAlertKinds: [...new Set(alerts.flatMap(x => x.signals))].sort(),
    manualSourceReviewRequired: alerts.length > 0,
    historicalReviewRequired: true,
    sourceRightsStillNeeded: true,
    humanM3BasketEvidenceStillNeeded: true,
    approvalForNewCapture: false,
    currentPriceVerified: false,
    currentAvailabilityVerified: false,
    humanReviewRequired: true,
    permissionVerified: false,
    liveRequests: 0,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    releaseDecision: 'hold',
  }
}

function checkedCliArgs(argv) {
  if (!Array.isArray(argv) || nodeTypes.isProxy(argv) ||
      Object.getPrototypeOf(argv) !== Array.prototype) fail()
  const props = Object.getOwnPropertyDescriptors(argv)
  const length = props.length?.value
  if ((length !== 4 && length !== 6) ||
      Reflect.ownKeys(props).length !== length + 1) fail()
  const args = []
  for (let i = 0; i < length; i++) {
    if (!Object.hasOwn(props[i] ?? {}, 'value') ||
        typeof props[i].value !== 'string') fail()
    args.push(props[i].value)
  }
  if (args[0] !== '--before-dir' || args[2] !== '--after-dir' ||
      (length === 6 && args[4] !== '--at')) fail()
  const before = args[1], after = args[3]
  if (![before, after].every(dir =>
    dir.trim() && !dir.startsWith('-') && dir.length <= 500) ||
    resolve(before) === resolve(after)) fail()
  return {
    before, after,
    referenceTime: length === 6 ? args[5] : new Date().toISOString(),
  }
}

/** CLI input is two explicitly reviewed PRIVATE immutable archive directories. */
export async function main(argv = process.argv.slice(2),
  write = data => process.stdout.write(data)) {
  const { before, after, referenceTime } = checkedCliArgs(argv)
  // Check syntax BEFORE reading any source, never echo invalid private paths.
  ownOptions({ referenceTime })
  let result
  try {
    const gate = JSON.parse(await readFile(new URL(
      '../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
    const oldBatch = await loadPrivateReviewedCaptureBatch(before, { referenceTime })
    const newBatch = await loadPrivateReviewedCaptureBatch(after, { referenceTime })
    result = rehearsePrivateM3RetailerDrift(gate, oldBatch, newBatch, { referenceTime })
  } catch { fail() }
  write(JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private M3 retailer drift rehearsal refused')
    process.exitCode = 2
  })
}
