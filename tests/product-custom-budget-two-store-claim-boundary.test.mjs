import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import { serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineStore, m3BaselineProducts,
  m3CandidateStore, m3CandidateProducts,
} from '../src/data/m3ComparisonFixture.ts'

// PRODUCT #1424: restore one planner snapshot, then independently price
// both synthetic store baskets. Do not confuse budget edits with supermarket
// savings. Neither catalog contains observed/current retailer prices.
const recipeIds = m2Recipes.map(({ id }) => id)
const recipeByDay = Object.fromEntries(
  m2InitialPlan.map(({ day, recipeId }) => [day, recipeId]),
)
function pairFor(activeDays, budget) {
  const restored = parsePlannerPreferencesWithCustomBudget(
    serializePlannerPreferences({ budget, activeDays, recipeByDay }),
    m2InitialPlan, recipeIds,
  )
  const plan = m2InitialPlan.map(({ day }) => ({
    day, recipeId: restored.recipeByDay[day],
  }))
  function build(store, products) {
    return buildOneStoreBasket({
      store, products, plan,
      activeDays: restored.activeDays, recipes: m2Recipes,
    })
  }
  const baseline = build(m3BaselineStore, m3BaselineProducts)
  const candidate = build(m3CandidateStore, m3CandidateProducts)
  return {
    baseline, candidate,
    comparison: compareFullBaskets({ baseline, candidate }),
  }
}

test('product #1424: custom budget edit cannot manufacture M3 money for complete or incomplete active weeks', () => {
  for (const activeDays of [
    ['Ma'], ['Di'], ['Wo'], ['Ma', 'Di', 'Wo', 'Do'],
  ]) {
    const original = pairFor(activeDays, 35)
    const pinned = JSON.stringify(original)
    for (const budget of [0.01, 27.5, 42.75, 1000]) {
      const current = pairFor(activeDays, budget)
      assert.deepEqual(current, original,
        `budget ${budget} changed two-store costs for ${activeDays.join(',')}`)
      assert.equal(JSON.stringify(original), pinned)
      for (const basket of [current.baseline, current.candidate]) {
        const result = assessPlannerBudgetCents(
          basket.totalCents, budget, basket.unresolvedLineCount,
        )
        if (basket.unresolvedLineCount > 0) {
          assert.equal(result.status, 'unknown')
          assert.equal('remainingCents' in result, false)
        } else {
          assert.equal(result.status, 'known')
          assert.equal(result.remainingCents,
            Math.round(budget * 100) - basket.totalCents)
        }
      }
      const { comparison, baseline, candidate } = current
      if (comparison.claimable) {
        assert.equal(comparison.deltaCents,
          candidate.totalCents - baseline.totalCents)
        assert.equal(comparison.savingsCents, -comparison.deltaCents || 0)
        assert.equal(
          comparison.lineDeltas.reduce((total, line) => total + line.deltaCents, 0),
          comparison.deltaCents,
        )
      } else {
        assert.equal(comparison.outcome, 'unknown')
        assert.equal(comparison.deltaCents, null)
        assert.equal(comparison.savingsCents, null)
        assert.deepEqual(comparison.lineDeltas, [])
      }
    }
  }
})
