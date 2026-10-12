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

// Synthetic-only combined acceptance of independent QA issues #1823 and #1513.
// This must never be misreported as observed PLUS or DekaMarkt savings.
const basket = (store, products) => buildOneStoreBasket({
  store, products, plan: m2InitialPlan,
  activeDays: m2DefaultActiveDays, recipes: m2Recipes,
})
const baselineBasket = basket(
  { ...m3BaselineStore, name: 'PLUS synthetic QA store' }, m3BaselineProducts,
)
const candidateBasket = basket(
  { ...m3CandidateStore, name: 'DekaMarkt synthetic QA store' }, m3CandidateProducts,
)
assert.equal(baselineBasket.unresolvedLineCount, 0)
assert.equal(candidateBasket.unresolvedLineCount, 0)

function fixture() {
  return {
    schemaVersion: 1,
    studyId: 'qa-visible-clock-composition',
    participantKey: 'synthetic-pseudonym-private',
    population: 'Fictieve studenten',
    region: 'Leiden',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-plus-baseline',
      observedAt: '2026-10-08T10:00:00.123000000Z',
      source: 'manual-cart',
      provenanceNote: 'Controlled synthetic QA data',
      basket: baselineBasket,
    },
    candidate: {
      evidenceId: 'qa-deka-candidate',
      observedAt: '2026-10-09T10:00:00.123000000Z',
      source: 'manual-cart',
      provenanceNote: 'Controlled synthetic QA data',
      basket: candidateBasket,
    },
  }
}

function assertNoClaim(study, expectedReasons) {
  const inputSnapshot = structuredClone(study)
  const result = assessWeeklyBasketStudy(study)
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
  assert.equal(result.observationWindowHours, null)
  for (const part of expectedReasons) {
    assert.ok(result.reasons.some(reason => reason.includes(part)),
      'missing ' + part + ' in ' + result.reasons.join('; '))
  }
  const report = buildObservedWeekReport(JSON.parse(JSON.stringify(study)))
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.observationWindowHours, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.attribution.status, 'unknown')
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.doesNotMatch(JSON.stringify(report), /synthetic-pseudonym-private/)
  assert.deepEqual(study, inputSnapshot)
}

for (const [field, value, reason] of [
  ['population', '\u200b\u2060', 'population is required'],
  ['region', '\u3164\u2800', 'region is required'],
  ['baseline.provenanceNote', '\u2800\u200d', 'baseline evidence provenance note'],
  ['candidate.provenanceNote', '\u115f\u0301', 'candidate evidence provenance note'],
]) {
  test('combined QA: illegible ' + field + ' and untrusted +1ns stay private unknown', () => {
    const study = fixture()
    const target = field.split('.')
    if (target.length === 1) study[field] = value
    else study[target[0]][target[1]] = value
    study.candidate.observedAt = '2026-10-09T10:00:00.123000001Z'
    assertNoClaim(study, [reason, 'candidate observedAt'])
  })
}

test('combined QA: readable provenance and exact 24h nine-digit zero tail still work privately', () => {
  const study = fixture()
  study.population = 'Studenten 🧑‍🍳'
  study.region = 'Leiden'
  study.baseline.provenanceNote = 'Zichtbare herkomst: cafe\u0301'
  study.candidate.provenanceNote = 'ملاحظات ⠃⠗⠇'
  const original = structuredClone(study)
  const result = assessWeeklyBasketStudy(study)
  assert.equal(result.claimable, true)
  assert.equal(result.observationWindowHours, 24)
  assert.deepEqual(result.reasons, [])
  const report = buildObservedWeekReport(JSON.parse(JSON.stringify(study)))
  assert.equal(report.claimable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.deepEqual(study, original)
})
