import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import { renderPrivateRetailerOperatorBrief } from '../scripts/retailer-private-operator-brief.mjs'

// Additional independent physical-clock acceptance AFTER original immutable
// 5+3 RED->GREEN replay; source is genuine historical PLUS/Deka fixture-shaped,
// but every altered date below is a fictional offline counterfactual.
// No network, current retailer prices, permission, secret or public savings.
async function genuineOfflineReport() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  return planPrivateRetailerRollout(rights, batch, {
    referenceTime: '2026-10-16T00:00:00Z', maxAgeHours: 24,
  })
}

function oneAcceptedShape(report) {
  const shape = report.retailers.flatMap(row => row.shapes)
    .find(row => row.acceptedSources > 0)
  assert.ok(shape?.latestArchivedCapturedAt)
  return shape
}

function mustStayPrivate(text) {
  assert.match(text, /ALLEEN HISTORISCHE BRONNEN/)
  assert.match(text, /live-ingestie en publieke prijzen blijven UIT/)
  assert.doesNotMatch(text, /https?:|sourceProductId|currentPriceCents|€/)
}

test('equivalent physical reference clock with +02:00 preserves historic private report', async () => {
  const report = await genuineOfflineReport()
  const original = renderPrivateRetailerOperatorBrief(report)
  const alternate = structuredClone(report)
  alternate.referenceTime = '2026-10-16T02:00:00+02:00'
  const output = renderPrivateRetailerOperatorBrief(alternate)
  assert.equal(output, original, 'UTC offset spelling cannot alter historical status')
  mustStayPrivate(output)
})

test('accepted archived source exactly 1ns after reference must refuse', async () => {
  const report = await genuineOfflineReport()
  oneAcceptedShape(report).latestArchivedCapturedAt = '2026-10-16T00:00:00.000000001Z'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), /geweigerd/)
})

test('offset-normalized accepted archive source 1ns in future must refuse', async () => {
  const report = await genuineOfflineReport()
  oneAcceptedShape(report).latestArchivedCapturedAt = '2026-10-16T02:00:00.000000001+02:00'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), /geweigerd/)
})

test('review and archived timestamps must reject physically impossible +14:01 offset', async () => {
  const report = await genuineOfflineReport()
  report.referenceTime = '2026-10-16T00:00:00+14:01'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), /geweigerd/)
  const other = await genuineOfflineReport()
  oneAcceptedShape(other).latestArchivedCapturedAt = '2026-10-15T12:00:00+14:01'
  assert.throws(() => renderPrivateRetailerOperatorBrief(other), /geweigerd/)
})
