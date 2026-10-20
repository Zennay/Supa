import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// All observations, participants, products and prices are synthetic.
// This file tests only the direct API's default clock, never field evidence.
function fictionalStudy() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'default-clock-fixture',
    participantKey: 'not-a-real-participant',
    population: 'synthetic tests only',
    region: 'synthetic region',
    weekStart: '2025-10-20',
    priceContext: 'in-store',
  })
  for (const [side, name, storeId, offset, at] of [
    ['baseline', 'PLUS fictional', 'plus-test', 20, '2025-10-22T10:00:00Z'],
    ['candidate', 'DekaMarkt fictional', 'deka-test', 0, '2025-10-22T11:00:00Z'],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = side + '-fictional'
    observation.observedAt = at
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Synthetic no-person/no-shop observation'
    observation.store = { id: storeId, name }
    observation.lines.forEach((line, index) => {
      const demand = sheet.requirements[index]
      line.observedProduct = {
        productId: storeId + '-' + demand.id,
        productName: demand.query,
        packAmount: demand.amount,
        packUnit: demand.unit,
        packCount: 1,
        priceCents: 100 + offset + index,
        available: true,
        sourceUrl: '',
        note: 'Synthetic only',
      }
    })
  }
  return buildWeeklyBasketStudyFromObservationSheet(sheet)
}

function requireNoMoney(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
}

test('missing clock never authorizes finance; explicit real-clock historical baskets remain comparable', () => {
  const study = fictionalStudy()
  const withoutClock = assessWeeklyBasketStudy(study)
  requireNoMoney(withoutClock)
  assert.ok(withoutClock.reasons.includes('assessment reference clock is required'))
  const withClock = assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() })
  assert.equal(withClock.claimable, true, withClock.reasons.join('; '))
  assert.equal(withClock.comparison.outcome, 'better')
  assert.equal(withClock.observationWindowHours, 1)
})

test('omitted clock refuses a fictional 2099 basket pair despite valid 1-hour window', () => {
  const study = fictionalStudy()
  study.weekStart = '2099-10-05'
  study.baseline.observedAt = '2099-10-10T12:00:00Z'
  study.candidate.observedAt = '2099-10-10T08:00:00-05:00'
  const result = assessWeeklyBasketStudy(study)
  requireNoMoney(result)
  assert.equal(result.observationWindowHours, 1)
  assert.ok(result.reasons.includes('assessment reference clock is required'))
  const withClock = assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() })
  requireNoMoney(withClock)
  assert.ok(withClock.reasons.some(reason => reason.includes('baseline observedAt is later than assessment reference time')))
  assert.ok(withClock.reasons.some(reason => reason.includes('candidate observedAt is later than assessment reference time')))
})

test('omitted clock rejects future baseline and candidate independently', () => {
  for (const side of ['baseline', 'candidate']) {
    const study = fictionalStudy()
    study[side].observedAt = '2099-10-10T12:00:00+14:00'
    const result = assessWeeklyBasketStudy(study)
    requireNoMoney(result)
    assert.ok(result.reasons.includes('assessment reference clock is required'))
    const withClock = assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() })
    requireNoMoney(withClock)
    assert.ok(withClock.reasons.some(reason => reason.includes(side + ' observedAt is later than assessment reference time')))
  }
})

test('explicit exact evaluation instant with timezone offset remains valid', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const study = fictionalStudy()
  study.weekStart = '2026-10-12'
  study.baseline.observedAt = '2026-10-15T12:00:00+01:00'
  study.candidate.observedAt = '2026-10-15T14:00:00+02:00'
  const exact = assessWeeklyBasketStudy(study, { referenceNowMs: now })
  assert.equal(exact.claimable, true, exact.reasons.join('; '))
  assert.equal(exact.observationWindowHours, 1)

  study.candidate.observedAt = '2026-10-15T14:00:00.001+02:00'
  const future = assessWeeklyBasketStudy(study, { referenceNowMs: now })
  requireNoMoney(future)
  assert.ok(future.reasons.some(reason => reason.includes('candidate observedAt is later than assessment reference time')))
})

test('explicit malformed clocks continue to fail closed instead of using default', () => {
  for (const referenceNowMs of [null, Number.NaN, Number.POSITIVE_INFINITY, '2099-10-10']) {
    const result = assessWeeklyBasketStudy(fictionalStudy(), { referenceNowMs })
    requireNoMoney(result)
    assert.ok(result.reasons.includes('assessment reference clock is malformed'))
  }
})
