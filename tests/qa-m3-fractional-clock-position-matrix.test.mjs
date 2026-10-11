import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// QA only: synthetic fixture prices are NOT observed supermarket prices.
const build = (store, products) => buildOneStoreBasket({
  store, products, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays,
})
const baselineBasket = build({ ...m3BaselineStore, name: 'PLUS synthetic test store' }, m3BaselineProducts)
const candidateBasket = build({ ...m3CandidateStore, name: 'DekaMarkt synthetic test store' }, m3CandidateProducts)
assert.equal(baselineBasket.unresolvedLineCount, 0)
assert.equal(candidateBasket.unresolvedLineCount, 0)

function study(first, second) {
  return {
    schemaVersion: 1, studyId: 'qa-fractional-clock-matrix',
    participantKey: 'synthetic-pseudonym-only',
    population: 'synthetic fixtures', region: 'synthetic region',
    weekStart: '2026-10-05', priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-clock-baseline', observedAt: first,
      source: 'manual-cart', provenanceNote: 'synthetic QA only',
      basket: baselineBasket,
    },
    candidate: {
      evidenceId: 'synthetic-clock-candidate', observedAt: second,
      source: 'manual-cart', provenanceNote: 'synthetic QA only',
      basket: candidateBasket,
    },
  }
}

test('QA M3 every nonzero fractional digit beyond milliseconds abstains, on either observation', () => {
  let attempts = 0
  const safe = '2026-10-08T11:00:00.123Z'
  for (let position = 4; position <= 9; position++) {
    for (const badSide of ['baseline', 'candidate']) {
      const fraction = '123' + '0'.repeat(position - 4) + '7' + '0'.repeat(9 - position)
      assert.equal(fraction.length, 9)
      const ambiguous = '2026-10-08T10:00:00.' + fraction + 'Z'
      const candidate = study(
        badSide === 'baseline' ? ambiguous : safe,
        badSide === 'candidate' ? ambiguous : safe,
      )
      const result = assessWeeklyBasketStudy(candidate)
      assert.equal(result.claimable, false, 'nonzero fractional position ' + position + ' on ' + badSide)
      assert.equal(result.comparison.claimable, false)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.deltaCents, null)
      assert.equal(result.comparison.savingsCents, null)
      assert.deepEqual(result.comparison.lineDeltas, [])
      assert.equal(result.observationWindowHours, null)
      assert.ok(result.reasons.some(reason => reason.includes(badSide + ' observedAt')),
        'missing invalid observedAt reason: ' + result.reasons.join('; '))
      const report = buildObservedWeekReport(candidate)
      assert.equal(report.claimable, false)
      assert.equal(report.outcome, 'unknown')
      assert.equal(report.deltaCents, null)
      assert.equal(report.savingsCents, null)
      assert.equal(report.observationWindowHours, null)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(report, 'participantKey'), false)
      attempts++
    }
  }
  assert.equal(attempts, 12)
})

test('QA M3 all permitted fraction lengths stay exact at a strict 24-hour boundary', () => {
  let attempts = 0
  for (let fractionLength = 1; fractionLength <= 9; fractionLength++) {
    const fraction = '123000000'.slice(0, fractionLength)
    const s = study(
      '2026-10-08T10:00:00.' + fraction + 'Z',
      '2026-10-09T10:00:00.' + fraction + 'Z',
    )
    const a = assessWeeklyBasketStudy(s)
    assert.equal(a.claimable, true, 'valid trailing-zero fraction length ' + fractionLength)
    assert.equal(a.observationWindowHours, 24)
    assert.deepEqual(a.reasons, [])
    const report = buildObservedWeekReport(s)
    assert.equal(report.claimable, true)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
    attempts++
  }
  assert.equal(attempts, 9)
})

test('QA M3 strict 24h with UTC offsets rejects a fourth fractional digit without rounding', () => {
  const invalid = study(
    '2026-10-24T16:00:00.0001+02:00',
    '2026-10-25T15:00:00.0000+01:00',
  )
  const assessment = assessWeeklyBasketStudy(invalid)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.observationWindowHours, null)
  assert.ok(assessment.reasons.some(reason => reason.includes('baseline observedAt')))
  const report = buildObservedWeekReport(invalid)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.deltaCents, null)
})
