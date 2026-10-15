import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// Fully fictional PLUS/DekaMarkt 11+11. No actual shopper, store request,
// price evidence, use-rights or eligibility for a public savings claim.
function studyAt(baseline, candidate) {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.weekStart = '2026-10-12'
  sheet.baseline.observedAt = baseline
  sheet.candidate.observedAt = candidate
  return buildWeeklyBasketStudyFromObservationSheet(sheet)
}

function refuseMoney(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
  assert.doesNotMatch(JSON.stringify(result), /fictional-operator-key/)
}

test('direct API samples the implicit clock once for an entire M3 comparison', (t) => {
  const at = '2026-10-15T08:00:00Z'
  const study = studyAt('2026-10-15T07:59:00Z', at)
  const unchanged = JSON.stringify(study)
  const now = Date.parse(at)
  let calls = 0
  t.mock.method(Date, 'now', () => {
    calls++
    // A second read would change the conclusion about the candidate.
    return calls === 1 ? now : now - 120000
  })
  const actual = assessWeeklyBasketStudy(study)
  assert.equal(calls, 1, 'Both basket timestamps must use one coherent evaluation instant')
  assert.equal(actual.claimable, true, actual.reasons.join('; '))
  assert.equal(actual.comparison.outcome, 'better')
  assert.equal(JSON.stringify(study), unchanged, 'Clock validation must not mutate evidence')
})

test('explicit trusted evaluation instant bypasses ambient clock entirely', (t) => {
  const study = studyAt('2026-10-15T07:59:00Z', '2026-10-15T08:00:00Z')
  const at = Date.parse('2026-10-15T08:00:00Z')
  let calls = 0
  t.mock.method(Date, 'now', () => { calls++; return 0 })
  const result = assessWeeklyBasketStudy(study, { referenceNowMs: at })
  assert.equal(calls, 0, 'Explicit deterministic reference must not read ambient time')
  assert.equal(result.claimable, true, result.reasons.join('; '))
  assert.equal(result.comparison.outcome, 'better')
})

test('one-millisecond future candidate is private, unknown and financially unclaimable', (t) => {
  const at = Date.parse('2026-10-15T08:00:00Z')
  const study = studyAt('2026-10-15T07:59:00Z', '2026-10-15T08:00:00.001Z')
  t.mock.method(Date, 'now', () => at)
  refuseMoney(assessWeeklyBasketStudy(study))
  assert.equal(study.candidate.observedAt, '2026-10-15T08:00:00.001Z')
})
