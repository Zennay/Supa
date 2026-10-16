/**
 * Offline operator brief for the reviewed PLUS/DekaMarkt source rollout.
 *
 * Converts the existing canonical rights + six-adapter health assessment into
 * readable Dutch next actions. No URLs, SKUs, amounts, price facts, credentials,
 * source hashes or archived capture times are ever copied to the output.
 * This is not a scheduler, capture endpoint or permission to publish prices.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { types as nodeTypes } from 'node:util'
import { planPrivateRetailerRollout } from './retailer-private-source-rollout-matrix.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const fail = () => { throw new Error('Offline winkelbron-startcontrole geweigerd') }
const kinds = ['product', 'catalog', 'offers']
const stores = ['plus', 'dekamarkt']
const shapeLabels = { product: 'Producten', catalog: 'Catalogus', offers: 'Aanbiedingen' }
const statuses = {
  'no-accepted-historical-capture': 'geen goedgekeurde historische invoer',
  'rejected-historical-input-needs-review': 'afgekeurde historische invoer onderzoeken',
  'archived-capture-outside-review-window': 'historisch bewijs ouder dan controlevenster',
  'historical-fixture-present': 'historische testinvoer aanwezig',
}
const actions = {
  'obtain-and-verify-retailer-source-rights': 'schriftelijke bronrechten controleren',
  'review-missing-offline-source-shapes': 'ontbrekende bronvormen onderzoeken',
  'review-rejected-adapter-evidence': 'afgekeurde broninvoer beoordelen',
  'review-historical-capture-freshness': 'verouderde archiefopnamen beoordelen',
  'validate-new-captures-offline-before-separate-release-approval':
    'nieuwe opnamen eerst offline valideren en apart laten vrijgeven',
}
const rightLabels = {
  permission_required: 'schriftelijke toestemming nodig',
  unresolved: 'gebruiksrechten nog onbekend',
  permitted: 'rechtenstatus positief; afzonderlijke live-vrijgave blijft nodig',
}
const safeCount = number => Number.isSafeInteger(number) && number >= 0 && number <= 50000

/**
 * The public renderer also has programmatic callers. Never execute a caller
 * getter or Proxy while preparing the human-facing review. Copy only bounded,
 * own, plain data descriptors BEFORE reading or formatting any field.
 * This does not claim caller input is licensed, fresh or production-ready.
 */
function snapshotReport(value, state = { seen: new WeakSet(), nodes: 0 }, depth = 0) {
  if (++state.nodes > 512 || depth > 12) fail()
  if (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return value
  if (typeof value === 'string') {
    if (value.length > 2048) fail()
    return value
  }
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value) ||
      state.seen.has(value)) fail()
  state.seen.add(value)
  if (Array.isArray(value)) {
    if (value.length > 512) fail()
    const keys = Reflect.ownKeys(value)
    if (keys.length !== value.length + 1 ||
        keys.some(key => typeof key !== 'string' ||
          (key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key)))) fail()
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail()
      return snapshotReport(descriptor.value, state, depth + 1)
    })
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) fail()
  const keys = Reflect.ownKeys(value)
  if (keys.length > 128) fail()
  const output = Object.create(null)
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 128) fail()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true) fail()
    Object.defineProperty(output, key, {
      value: snapshotReport(descriptor.value, state, depth + 1),
      enumerable: true, writable: true, configurable: true,
    })
  }
  return output
}

/**
 * A date parser must not quietly normalize impossible civil dates or discard
 * 4–9 fractional-second digits. These timestamps identify historical M1
 * evidence only and never make a current-price or publication claim.
 */
function physicalReviewInstant(iso) {
  const parts = typeof iso === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
    : null
  if (!parts) fail()
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const hour = Number(parts[4])
  const minute = Number(parts[5])
  const second = Number(parts[6])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1970 || month < 1 || month > 12 ||
      day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59) fail()
  const timezone = parts[8]
  if (timezone !== 'Z') {
    const offsetHour = Number(timezone.slice(1, 3))
    const offsetMinute = Number(timezone.slice(4, 6))
    if (offsetHour > 14 || offsetMinute > 59 ||
        (offsetHour === 14 && offsetMinute !== 0)) fail()
  }
  const milliseconds = Date.parse(iso)
  if (!Number.isFinite(milliseconds)) fail()
  // The JS Date parser truncates beyond milliseconds; preserve all 9 digits.
  const nanofraction = (parts[7] ?? '').padEnd(9, '0')
  return BigInt(milliseconds) * 1_000_000n +
    BigInt(nanofraction.slice(3) || '0')
}

function expectedShapeStatus(shape) {
  return shape.acceptedSources === 0 ? 'no-accepted-historical-capture'
    : shape.rejectedSources > 0 ? 'rejected-historical-input-needs-review'
      : shape.staleHistoricalCaptures > 0
        ? 'archived-capture-outside-review-window'
        : 'historical-fixture-present'
}

function expectedNextActions(retailer) {
  return [
    ...(!retailer.sourceRightsReadyForProduction
      ? ['obtain-and-verify-retailer-source-rights'] : []),
    ...(retailer.shapes.some(shape => shape.acceptedSources === 0)
      ? ['review-missing-offline-source-shapes'] : []),
    ...(retailer.shapes.some(shape => shape.rejectedSources > 0)
      ? ['review-rejected-adapter-evidence'] : []),
    ...(retailer.shapes.some(shape => shape.staleHistoricalCaptures > 0)
      ? ['review-historical-capture-freshness'] : []),
    'validate-new-captures-offline-before-separate-release-approval',
  ]
}

/**
 * Intentionally accept only reports that still state the historical-only,
 * no-live/no-publication policy. All human-facing text comes from local
 * allowlists, not source-controlled or retailer-provided strings.
 */
export function renderPrivateRetailerOperatorBrief(report) {
  report = snapshotReport(report)
  if (!report || typeof report !== 'object' ||
      report.schemaVersion !== 1 ||
      report.mode !== 'private-retailer-rollout-matrix' ||
      report.context !== 'reviewed-historical-captures-not-live-prices' ||
      report.requiresHumanReview !== true ||
      report.permissionVerifiedForNewCapture !== false ||
      report.liveRetailerRequests !== 0 ||
      report.liveScrapingEnabled !== false ||
      report.scheduledRefreshEnabled !== false ||
      report.publicSavingsClaimEligible !== false ||
      report.productionEnabled !== false ||
      report.rightsGateProductionReady !== false ||
      !Number.isSafeInteger(report.maxAgeHours) ||
      report.maxAgeHours < 1 || report.maxAgeHours > 720 ||
      !Array.isArray(report.retailers) || report.retailers.length !== 2 ||
      report.retailerCount !== 2 || report.expectedShapeCount !== 6 ||
      !safeCount(report.historicalAcceptedShapes) ||
      !safeCount(report.missingHistoricalShapeCount) ||
      !safeCount(report.staleHistoricalCaptures)) fail()

  const referenceNanos = physicalReviewInstant(report.referenceTime)
  if (referenceNanos > BigInt(Date.now()) * 1_000_000n) fail()
  const lines = [
    'SUPA — offline winkelbron-startcontrole',
    'ALLEEN HISTORISCHE BRONNEN. Geen live ophalen, geplande vernieuwing, actuele prijzen of besparingsclaims.',
    '',
  ]
  let accepted = 0
  let missing = 0
  let stale = 0
  const seen = new Set()
  for (const retailer of report.retailers) {
    if (!retailer || !stores.includes(retailer.retailerId) ||
        seen.has(retailer.retailerId) ||
        !Object.hasOwn(rightLabels, retailer.permissionStatus) ||
        typeof retailer.sourceRightsReadyForProduction !== 'boolean' ||
        (retailer.permissionStatus !== 'permitted' &&
          retailer.sourceRightsReadyForProduction !== false) ||
        retailer.liveScrapingEnabled !== false ||
        retailer.scheduledRefreshEnabled !== false ||
        retailer.currentPricePublicationAllowed !== false ||
        retailer.technicalAdapterShapeCount !== 3 ||
        !Array.isArray(retailer.shapes) || retailer.shapes.length !== 3 ||
        !Array.isArray(retailer.nextActions)) fail()

    seen.add(retailer.retailerId)
    lines.push(
      retailer.retailerId === 'plus' ? 'PLUS' : 'DekaMarkt',
      'Bronrechten: ' + rightLabels[retailer.permissionStatus],
    )
    const observedKinds = new Set()
    let acceptedStore = 0
    for (const shape of retailer.shapes) {
      if (!shape || !kinds.includes(shape.kind) || observedKinds.has(shape.kind) ||
          !Object.hasOwn(statuses, shape.status) ||
          !safeCount(shape.historicalSources) ||
          !safeCount(shape.acceptedSources) ||
          !safeCount(shape.rejectedSources) ||
          !safeCount(shape.historicalObservations) ||
          !safeCount(shape.staleHistoricalCaptures) ||
          !safeCount(shape.unknownPriceObservations) ||
          shape.historicalSources !== shape.acceptedSources + shape.rejectedSources ||
          shape.staleHistoricalCaptures > shape.acceptedSources ||
          shape.unknownPriceObservations > shape.historicalObservations ||
          shape.status !== expectedShapeStatus(shape) ||
          (shape.acceptedSources === 0 && shape.latestArchivedCapturedAt !== null) ||
          (shape.acceptedSources > 0 &&
            (typeof shape.latestArchivedCapturedAt !== 'string' ||
              shape.latestArchivedCapturedAt.length > 64 ||
              physicalReviewInstant(shape.latestArchivedCapturedAt) > referenceNanos)) ||
          shape.eligibleForLiveCapture !== false ||
          shape.verifiedCurrentPriceObservations !== 0) fail()
      observedKinds.add(shape.kind)
      if (shape.acceptedSources) acceptedStore++
      else missing++
      stale += shape.staleHistoricalCaptures
      lines.push('  ' + shapeLabels[shape.kind] + ': ' + statuses[shape.status] +
        ' (' + shape.acceptedSources + ' geaccepteerde, ' +
        shape.rejectedSources + ' afgekeurde archiefbronnen; ' +
        shape.unknownPriceObservations + ' historische prijswaarnemingen onbekend)')
    }
    if (observedKinds.size !== 3 || retailer.acceptedHistoricalShapes !== acceptedStore ||
        !retailer.nextActions.length ||
        retailer.nextActions.some(action => !Object.hasOwn(actions, action)) ||
        new Set(retailer.nextActions).size !== retailer.nextActions.length ||
        JSON.stringify(retailer.nextActions) !==
          JSON.stringify(expectedNextActions(retailer))) fail()
    accepted += acceptedStore
    if (retailer.shapes.some(shape => shape.unknownPriceObservations > 0)) {
      lines.push('Aandacht: historische waarnemingen zonder bruikbare prijs; controleer bronextractie handmatig.')
    }
    lines.push('Vervolg: ' + retailer.nextActions.map(action => actions[action]).join('; ') + '.', '')
  }
  if (seen.size !== 2 || accepted !== report.historicalAcceptedShapes ||
      missing !== report.missingHistoricalShapeCount ||
      stale !== report.staleHistoricalCaptures) fail()
  lines.push('Conclusie: voorbereiding/review mogelijk; live-ingestie en publieke prijzen blijven UIT.')
  return lines.join('\n') + '\n'
}

/** A zero-argument dry-run against the six committed historical M1 shapes. */
export async function main(argv = process.argv.slice(2),
  write = text => process.stdout.write(text)) {
  // Array.isArray(revokedProxy) itself throws; inspect before touching argv.
  // Node's native proxy test does not invoke user getters or Proxy handlers.
  if (nodeTypes.isProxy(argv) || !Array.isArray(argv) || argv.length !== 0) fail()
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  const report = planPrivateRetailerRollout(rights, batch)
  const brief = renderPrivateRetailerOperatorBrief(report)
  write(brief)
  return brief
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Offline winkelbron-startcontrole geweigerd'); process.exitCode = 2 })
}
