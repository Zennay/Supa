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
 * Intentionally accept only reports that still state the historical-only,
 * no-live/no-publication policy. All human-facing text comes from local
 * allowlists, not source-controlled or retailer-provided strings.
 */
export function renderPrivateRetailerOperatorBrief(report) {
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
          shape.eligibleForLiveCapture !== false ||
          shape.verifiedCurrentPriceObservations !== 0) fail()
      observedKinds.add(shape.kind)
      if (shape.acceptedSources) acceptedStore++
      else missing++
      stale += shape.staleHistoricalCaptures
      lines.push('  ' + shapeLabels[shape.kind] + ': ' + statuses[shape.status] +
        ' (' + shape.acceptedSources + ' geaccepteerde, ' +
        shape.rejectedSources + ' afgekeurde archiefbronnen)')
    }
    if (observedKinds.size !== 3 || retailer.acceptedHistoricalShapes !== acceptedStore ||
        !retailer.nextActions.length ||
        retailer.nextActions.some(action => !Object.hasOwn(actions, action)) ||
        new Set(retailer.nextActions).size !== retailer.nextActions.length) fail()
    accepted += acceptedStore
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
