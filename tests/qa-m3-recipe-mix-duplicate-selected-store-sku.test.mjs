import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Stronger QA than a foreign-store duplicate: a duplicated ID inside the
// selected retailer cannot resolve which same-ID price/pack was observed.
const ids = m2Recipes.map(({ id }) => id)
function planFor(index) {
  let n = index
  return m2InitialPlan.map(({ day }) => {
    const recipeId = ids[n % ids.length]
    n = Math.floor(n / ids.length)
    return { day, recipeId }
  })
}
function basket(store, products, plan) {
  return buildOneStoreBasket({
    store, products, plan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
}
function assertUnknown(comparison, context) {
  assert.equal(comparison.claimable, false, context)
  assert.equal(comparison.outcome, 'unknown', context)
  assert.equal(comparison.savingsCents, null, context)
  assert.equal(comparison.deltaCents, null, context)
  assert.deepEqual(comparison.lineDeltas, [], context)
}

test('every four-day M3 recipe mix refuses duplicate selected-store SKU identifiers with clashing prices', () => {
  for (let i = 0; i < ids.length ** m2DefaultActiveDays.length; i += 1) {
    const plan = planFor(i)
    const baseline = basket(m3BaselineStore, m3BaselineProducts, plan)
    const candidate = basket(m3CandidateStore, m3CandidateProducts, plan)
    assert.equal(compareFullBaskets({ baseline, candidate }).claimable, true)

    for (const [side, store, products, otherBasket] of [
      ['baseline', m3BaselineStore, m3BaselineProducts, candidate],
      ['candidate', m3CandidateStore, m3CandidateProducts, baseline],
    ]) {
      const good = side === 'baseline' ? baseline : candidate
      const purchased = good.lines.find((line) => line.status === 'matched')
      assert.ok(purchased, `mix ${i} / ${side}`)
      const source = products.find(({ id }) => id === purchased.productId)
      assert.ok(source)
      const duplicateWithConflictingPrice = {
        ...source, priceCents: source.priceCents === 0 ? 1 : 0,
      }
      const contaminated = basket(store, [...products, duplicateWithConflictingPrice], plan)
      const sameRequirement = contaminated.lines.find(({ id }) => id === purchased.id)
      assert.equal(sameRequirement?.status, 'unresolved', `mix ${i} / ${side} duplicate SKU`)
      assert.ok(contaminated.unresolvedLineCount > 0)
      const result = side === 'baseline'
        ? compareFullBaskets({ baseline: contaminated, candidate: otherBasket })
        : compareFullBaskets({ baseline: otherBasket, candidate: contaminated })
      assertUnknown(result, `mix ${i} / ${side} cannot claim with duplicate SKU`)
      assert.match(result.reasons.join(' '), /unresolved ingredients/)
    }
  }
})
