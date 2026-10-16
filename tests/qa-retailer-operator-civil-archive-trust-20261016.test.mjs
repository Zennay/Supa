import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import { renderPrivateRetailerOperatorBrief } from '../scripts/retailer-private-operator-brief.mjs'

// Independent QA 2/2, only six REAL archived PLUS/Deka adapter fixture shapes
// and private in-memory counterfactual edits. No retailer HTTP, live prices,
// capture creation, rights grant, public savings, secrets or CI-owner changes.
const refusal = /startcontrole geweigerd/i

async function historicalReport() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
    'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  return planPrivateRetailerRollout(rights, batch, {
    referenceTime: '2026-10-16T00:00:00Z',
    maxAgeHours: 24,
  })
}

function acceptedShape(report) {
  const shape = report.retailers.flatMap(r => r.shapes)
    .find(item => item.acceptedSources > 0)
  assert.ok(shape, 'historical PLUS/Deka acceptance control is required')
  assert.match(shape.latestArchivedCapturedAt, /^\d{4}-\d{2}-\d{2}T/)
  return shape
}

test('positive: real six-source offline brief remains private, deterministic and nonpublishable', async () => {
  const report = await historicalReport()
  const original = structuredClone(report)
  const output = renderPrivateRetailerOperatorBrief(report)
  assert.equal(renderPrivateRetailerOperatorBrief(report), output)
  assert.match(output, /ALLEEN HISTORISCHE BRONNEN/)
  assert.match(output, /live-ingestie en publieke prijzen blijven UIT/)
  assert.doesNotMatch(output, /https?:|sha256|capturedAt|sourceProductId|€/i)
  assert.deepEqual(report, original, 'the operator renderer must not mutate caller data')
})

test('operator referenceTime must reject normalized non-leap February 29 [EXPECTED RED]', async () => {
  const report = await historicalReport()
  report.referenceTime = '2025-02-29T12:00:00Z'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), refusal)
})

test('operator referenceTime must reject normalized February 30 [EXPECTED RED]', async () => {
  const report = await historicalReport()
  report.referenceTime = '2026-02-30T12:00:00Z'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), refusal)
})

test('operator archived capture cannot be arbitrary short text [EXPECTED RED]', async () => {
  const report = await historicalReport()
  acceptedShape(report).latestArchivedCapturedAt = 'not-a-capture-clock'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), refusal)
})

test('operator archived capture cannot be an impossible Gregorian day [EXPECTED RED]', async () => {
  const report = await historicalReport()
  acceptedShape(report).latestArchivedCapturedAt = '2026-02-30T00:00:00Z'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), refusal)
})

test('operator archived capture cannot be newer than report reference instant [EXPECTED RED]', async () => {
  const report = await historicalReport()
  acceptedShape(report).latestArchivedCapturedAt = '2030-01-01T00:00:00Z'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), refusal)
})
