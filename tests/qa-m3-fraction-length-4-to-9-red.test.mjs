import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Separate cross-precision oracle from #1513: 4..9 ISO fractional digits
// encode real elapsed instants that Date.parse silently rounds to milliseconds.
// Test values are wholly synthetic, not human observed retailer evidence.
const one = buildOneStoreBasket({
  store: m3BaselineStore, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays, products: m3BaselineProducts,
})
const two = buildOneStoreBasket({
  store: m3CandidateStore, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays, products: m3CandidateProducts,
})
assert.equal(one.unresolvedLineCount, 0)
assert.equal(two.unresolvedLineCount, 0)

function syntheticStudy(first, second) {
  return {
    schemaVersion: 1, studyId: 'synthetic-precision-lengths',
    participantKey: 'qa-pseudo-01', population: 'synthetic QA only',
    region: 'synthetic QA only', weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-a-01', observedAt: first,
      source: 'manual-cart', provenanceNote: 'Synthetic negative boundary test',
      basket: one,
    },
    candidate: {
      evidenceId: 'synthetic-b-01', observedAt: second,
      source: 'manual-cart', provenanceNote: 'Synthetic negative boundary test',
      basket: two,
    },
  }
}

for (let digits = 4; digits <= 9; digits += 1) {
  const first = `2026-10-01T10:00:00.${'0'.repeat(digits)}Z`
  const second = `2026-10-02T10:00:00.${'0'.repeat(digits - 1)}1Z`
  const fractionalNs = 10n ** BigInt(9 - digits)

  test(`M3 precision expected RED: ISO ${digits}-digit fractional +${fractionalNs}ns outside strict 24h`, () => {
    // Exact expected interval is 24h + one unit at the supplied precision.
    assert.equal(
      BigInt(Date.parse('2026-10-02T10:00:00Z') -
        Date.parse('2026-10-01T10:00:00Z')) * 1_000_000n + fractionalNs,
      86_400_000_000_000n + fractionalNs,
    )
    const result = assessWeeklyBasketStudy(syntheticStudy(first, second))
    assert.equal(result.claimable, false)
    assert.equal(result.comparison.claimable, false)
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.deltaCents, null)
    assert.equal(result.comparison.savingsCents, null)
    assert.deepEqual(result.comparison.lineDeltas, [])
    assert.ok(result.reasons.length > 0)
  })
}

test('M3 precision positive: accepted fractional precision 1..9 with only trailing zeros', () => {
  for (let digits = 1; digits <= 9; digits += 1) {
    const suffix = '0'.repeat(digits)
    const first = `2026-10-01T10:00:00.${suffix}Z`
    const second = `2026-10-02T10:00:00.${suffix}Z`
    const result = assessWeeklyBasketStudy(syntheticStudy(first, second))
    assert.equal(result.claimable, true, `digits=${digits}`)
    assert.equal(result.comparison.claimable, true, `digits=${digits}`)
    assert.deepEqual(result.reasons, [], `digits=${digits}`)
  }
})

test('M3 precision positive: true +1ms remains outside and unknown', () => {
  const result = assessWeeklyBasketStudy(syntheticStudy(
    '2026-10-01T10:00:00.000Z',
    '2026-10-02T10:00:00.001Z',
  ))
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
})
