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
          (key !== 'length' && !/^(?:0|[1-9]\\d*)$/.test(key)))) fail()
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
      typeof report.referenceTime !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(report.referenceTime) ||
      !Number.isFinite(Date.parse(report.referenceTime)) ||
      !Array.isArray(report.retailers) || report.retailers.length !== 2 ||
      report.retailerCount !== 2 || report.expectedShapeCount !== 6 ||
      !safeCount(report.historicalAcceptedShapes) ||
      !safeCount(report.missingHistoricalShapeCount) ||
      !safeCount(report.staleHistoricalCaptures)) fail()

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
              shape.latestArchivedCapturedAt.length > 64)) ||
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
  if (!Array.isArray(argv) || argv.length !== 0) fail()
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
