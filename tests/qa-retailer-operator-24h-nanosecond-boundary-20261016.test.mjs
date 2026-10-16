/**
 * Independent M3 quality-validation: exact physical freshness threshold.
 *
 * Synthetic offline changes to a cloned genuine six-shape archived review
 * report; no retailer requests, current prices, source permissions or claims.
 * Targets the product owner's frozen #3213 source without editing its files.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import { renderPrivateRetailerOperatorBrief } from '../scripts/retailer-private-operator-brief.mjs'

const referenceTime = '2026-10-16T04:00:00.000000000Z'

async function boundReport(archiveTime) {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  const report = structuredClone(planPrivateRetailerRollout(rights, batch, {
    referenceTime, maxAgeHours: 24,
  }))
  // Make one synthetic accepted shape exactly fresh; keep all other genuine
  // historical six-shape totals and conservative real permission flags intact.
  const retailer = report.retailers.find(row =>
    row.shapes.some(shape => shape.acceptedSources > 0 && shape.rejectedSources === 0))
  assert.ok(retailer, 'genuine six-shape archive must have an accepted shape')
  const shape = retailer.shapes.find(row =>
    row.acceptedSources > 0 && row.rejectedSources === 0)
  report.staleHistoricalCaptures -= shape.staleHistoricalCaptures
  shape.staleHistoricalCaptures = 0
  shape.latestArchivedCapturedAt = archiveTime
  shape.status = 'historical-fixture-present'
  retailer.nextActions = retailer.nextActions.filter(action =>
    action !== 'review-historical-capture-freshness')
  if (retailer.shapes.some(row => row.staleHistoricalCaptures > 0)) {
    const finalAction = retailer.nextActions.pop()
    retailer.nextActions.push('review-historical-capture-freshness', finalAction)
  }
  return { report, retailer, shape }
}

function safeBrief(report) {
  const brief = renderPrivateRetailerOperatorBrief(report)
  assert.match(brief, /ALLEEN HISTORISCHE BRONNEN/)
  assert.match(brief, /live-ingestie en publieke prijzen blijven UIT/)
  assert.doesNotMatch(brief, /https?:|access_token|sourceProductId|capturedAt|currentPriceCents|€/)
  return brief
}

test('M3 archive exactly 24h old is admissible as historical-only evidence in both UTC and offset clocks', async () => {
  const utc = await boundReport('2026-10-15T04:00:00.000000000Z')
  const offset = await boundReport('2026-10-15T06:00:00.000000000+02:00')
  const utcBrief = safeBrief(utc.report)
  assert.equal(safeBrief(offset.report), utcBrief,
    'physically equal archive clocks must not affect private operator wording')
  const justInside = await boundReport('2026-10-15T04:00:00.000000001Z')
  assert.equal(safeBrief(justInside.report), utcBrief)
})

test('M3 archive 24h + 1ns old cannot suppress the stale evidence action', async () => {
  const { report } = await boundReport('2026-10-15T03:59:59.999999999Z')
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), /geweigerd/,
    'sub-millisecond stale source must not be misreported as fresh')
  const offset = await boundReport('2026-10-15T05:59:59.999999999+02:00')
  assert.throws(() => renderPrivateRetailerOperatorBrief(offset.report), /geweigerd/)
})

test('M3 stale 24h+1ns shape is accepted only with synchronized status, counters and human action', async () => {
  const { report, retailer, shape } =
    await boundReport('2026-10-15T03:59:59.999999999Z')
  shape.staleHistoricalCaptures = 1
  shape.status = 'archived-capture-outside-review-window'
  report.staleHistoricalCaptures++
  if (!retailer.nextActions.includes('review-historical-capture-freshness')) {
    const finalAction = retailer.nextActions.pop()
    retailer.nextActions.push('review-historical-capture-freshness', finalAction)
  }
  const brief = safeBrief(report)
  assert.match(brief, /historisch bewijs ouder dan controlevenster/)
  assert.match(brief, /verouderde archiefopnamen beoordelen/)
  const contradicted = structuredClone(report)
  contradicted.retailers.find(row => row.retailerId === retailer.retailerId)
    .shapes.find(row => row.kind === shape.kind).staleHistoricalCaptures = 0
  assert.throws(() => renderPrivateRetailerOperatorBrief(contradicted), /geweigerd/)
})

test('M3 exact 24h cut-off never permits fake live permission or present-day price flags', async () => {
  const { report } = await boundReport('2026-10-15T04:00:00Z')
  for (const mutate of [
    value => { value.permissionVerifiedForNewCapture = true },
    value => { value.publicSavingsClaimEligible = true },
    value => { value.retailers[0].currentPricePublicationAllowed = true },
    value => { value.retailers[1].shapes[0].verifiedCurrentPriceObservations = 1 },
  ]) {
    const bad = structuredClone(report)
    mutate(bad)
    assert.throws(() => renderPrivateRetailerOperatorBrief(bad), /geweigerd/)
  }
  safeBrief(report)
})
