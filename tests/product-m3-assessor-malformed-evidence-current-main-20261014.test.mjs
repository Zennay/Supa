import assert from 'node:assert/strict'
import test from 'node:test'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// The complete 11+11 test fixtures are fictional. No store quotes or participant
// records and no claim of real savings enter this regression.
function completeStudy() {
  return buildWeeklyBasketStudyFromObservationSheet(buildFictionalPricedSheet(90))
}

function isSafelyUnknown(result, label) {
  assert.equal(result.claimable, false, label)
  assert.equal(result.comparison.claimable, false, label)
  assert.equal(result.comparison.outcome, 'unknown', label)
  assert.equal(result.comparison.deltaCents, null, label)
  assert.equal(result.comparison.savingsCents, null, label)
  assert.ok(Number.isNaN(result.comparison.baselineTotalCents), label)
  assert.equal(JSON.parse(JSON.stringify(result)).comparison.baselineTotalCents, null, label)
  assert.ok(Number.isNaN(result.comparison.candidateTotalCents), label)
  assert.equal(JSON.parse(JSON.stringify(result)).comparison.candidateTotalCents, null, label)
  assert.deepEqual(result.comparison.lineDeltas, [], label)
  assert.equal(result.observationWindowHours, null, label)
  assert.equal(result.attribution.status, 'unknown', label)
  assert.ok(result.reasons.length > 0 && result.reasons.every(reason =>
    typeof reason === 'string' && !reason.includes('student-test')), label)
}

test('M3 direct claim boundary safely refuses missing and scalar study roots', () => {
  for (const [label, study] of [
    ['undefined', undefined], ['null', null], ['number', 99],
    ['text', 'synthetic-data'], ['array', []],
  ]) {
    assert.doesNotThrow(() => isSafelyUnknown(assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() }), label))
  }
})

test('M3 refuses nested retailer evidence/basket/store/line containers without throwing', () => {
  const cases = [
    ['baseline evidence null', s => { s.baseline = null }],
    ['candidate evidence absent', s => { delete s.candidate }],
    ['baseline evidence array', s => { s.baseline = [] }],
    ['baseline basket null', s => { s.baseline.basket = null }],
    ['candidate basket scalar', s => { s.candidate.basket = 1 }],
    ['baseline store null', s => { s.baseline.basket.store = null }],
    ['candidate store array', s => { s.candidate.basket.store = [] }],
    ['baseline lines null', s => { s.baseline.basket.lines = null }],
    ['candidate lines object', s => { s.candidate.basket.lines = {} }],
    ['baseline matched line pack null', s => {
      s.baseline.basket.lines[0].pack = null
    }],
    ['candidate matched line requirement null', s => {
      s.candidate.basket.lines[0].requirement = null
    }],
  ]
  for (const [name, mutate] of cases) {
    const study = completeStudy()
    mutate(study)
    const original = JSON.stringify(study)
    assert.doesNotThrow(() => isSafelyUnknown(assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() }), name), name)
    assert.equal(JSON.stringify(study), original, name + ': no evidence mutation')
  }
})

test('M3 refuses a throwing nested runtime accessor rather than propagating its error', () => {
  const study = completeStudy()
  Object.defineProperty(study.baseline.basket, 'store', {
    enumerable: true,
    get() { throw new Error('private field content must not leak') },
  })
  const result = assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() })
  isSafelyUnknown(result, 'throwing store')
  assert.doesNotMatch(result.reasons.join(' '), /private field content/)
})

test('M3 evidence preflight never executes an accessor masquerading as a store or evidence', () => {
  for (const location of ['root', 'basket']) {
    const study = completeStudy()
    let getterCalls = 0
    if (location === 'root') {
      const evidence = study.baseline
      Object.defineProperty(study, 'baseline', {
        enumerable: true,
        get() { getterCalls += 1; return evidence },
      })
    } else {
      const store = study.baseline.basket.store
      Object.defineProperty(study.baseline.basket, 'store', {
        enumerable: true,
        get() { getterCalls += 1; return store },
      })
    }
    isSafelyUnknown(assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() }), location + ' accessor')
    assert.equal(getterCalls, 0, 'no invocation of untrusted evidence getters')
  }
})

test('normal full 11+11 synthetic M3 basket keeps claimability with stable inputs', () => {
  const study = completeStudy()
  const original = JSON.stringify(study)
  const result = assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() })
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.ok(Number.isSafeInteger(result.comparison.baselineTotalCents))
  assert.ok(Number.isSafeInteger(result.comparison.candidateTotalCents))
  assert.equal(result.reasons.length, 0)
  assert.equal(JSON.stringify(study), original)
})
