import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// Invented PLUS/Deka 11+11 rows only; no actual prices, visits,
// participant, retailer rights or public savings evidence.
function fictionalStudy() {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.weekStart = '2026-10-12'
  sheet.baseline.observedAt = '2026-10-15T07:59:00Z'
  sheet.candidate.observedAt = '2026-10-15T08:00:00Z'
  return buildWeeklyBasketStudyFromObservationSheet(sheet)
}
function assertPrivateUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
  assert.doesNotMatch(JSON.stringify(result), /fictional-operator-key/)
}

test('omitted reference clock is fail-closed even for historical, mathematically comparable fiction', (t) => {
  const study = fictionalStudy()
  const unchanged = JSON.stringify(study)
  let calls = 0
  t.mock.method(Date, 'now', () => { calls++; return Date.parse('2099-01-01T00:00:00Z') })
  const result = assessWeeklyBasketStudy(study)
  assertPrivateUnknown(result)
  assert.equal(calls, 0, 'Pure financial domain must never sample ambient Date.now')
  assert.equal(JSON.stringify(study), unchanged, 'No silent mutation of observation evidence')
})

test('explicit injected clock permits only mathematically valid old fictional comparison', (t) => {
  const study = fictionalStudy()
  const referenceNowMs = Date.parse('2026-10-15T08:00:00Z')
  let calls = 0
  t.mock.method(Date, 'now', () => { calls++; return 0 })
  const result = assessWeeklyBasketStudy(study, { referenceNowMs })
  assert.equal(calls, 0, 'Provided evaluation time must fully isolate pure financial code')
  assert.equal(result.claimable, true, result.reasons.join('; '))
  assert.equal(result.comparison.outcome, 'better')
})

test('one-millisecond future input remains unknown with explicit deterministic clock', () => {
  const study = fictionalStudy()
  study.candidate.observedAt = '2026-10-15T08:00:00.001Z'
  const before = JSON.stringify(study)
  const result = assessWeeklyBasketStudy(study, {
    referenceNowMs: Date.parse('2026-10-15T08:00:00Z'),
  })
  assertPrivateUnknown(result)
  assert.equal(JSON.stringify(study), before)
})

test('untrusted explicit clock never falls back to ambient time', (t) => {
  const study = fictionalStudy()
  let calls = 0
  t.mock.method(Date, 'now', () => { calls++; return Date.parse('2099-01-01T00:00:00Z') })
  for (const referenceNowMs of [null, NaN, Infinity, '2026-10-15T08:00:00Z']) {
    const result = assessWeeklyBasketStudy(study, { referenceNowMs })
    assertPrivateUnknown(result)
    assert.ok(result.reasons.includes('assessment reference clock is malformed'))
  }
  assert.equal(calls, 0)
})
