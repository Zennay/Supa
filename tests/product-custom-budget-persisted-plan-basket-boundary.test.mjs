import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import { parsePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// PRODUCT #1424: independently exercise persisted plan sanitation through
// actual basket assembly on the proposed custom-budget owner stack (#1510).
// Controlled examples only; no retailer observations or savings claims.
const recipeIds = m2Recipes.map(({ id }) => id)

function currentBasket(user, store, products) {
  const plan = m2InitialPlan.map(({ day }) => ({
    day,
    recipeId: user.recipeByDay[day],
  }))
  return buildOneStoreBasket({
    store, products, plan, activeDays: user.activeDays, recipes: m2Recipes,
  })
}

test('product #1424: custom restore removes duplicate/stale days and recipes before two-store basket construction', () => {
  const raw = JSON.stringify({
    budget: 42.75,
    activeDays: ['Do', 'Wo', 'Ma', 'Wo', 'Vr', 'Ma'],
    recipeByDay: {
      Ma: 'pasta', Di: 'retired-recipe', Wo: 'teriyaki',
      Do: 'tikka', Vr: 'pasta',
    },
  })
  const restored = parsePlannerPreferencesWithCustomBudget(
    raw, m2InitialPlan, recipeIds,
  )

  assert.equal(restored.budget, 42.75)
  assert.deepEqual(restored.activeDays, ['Ma', 'Wo', 'Do'])
  assert.deepEqual(restored.recipeByDay, {
    Ma: 'pasta', Di: 'teriyaki', Wo: 'teriyaki', Do: 'tikka',
  })
  const legacy = parsePlannerPreferences(raw, m2InitialPlan, recipeIds)
  assert.equal(legacy.budget, 35,
    'old chip-only consumers must not silently acquire custom budget support')
  assert.deepEqual(legacy.activeDays, restored.activeDays)
  assert.deepEqual(legacy.recipeByDay, restored.recipeByDay)

  for (const [store, products] of [
    [m2Store, m2Products],
    [m3CandidateStore, m3CandidateProducts],
  ]) {
    const current = currentBasket(restored, store, products)
    assert.equal(current.selectedMealCount, 3)
    assert.ok(current.lines.length > 0)
    assert.deepEqual(currentBasket(legacy, store, products), current,
      'budget-only differences cannot alter the actual demand or pack selection')
  }
})

test('product #1424: poisoned budgets fall back without losing a valid meal edit or inventing money', () => {
  for (const budget of ['27,50', null, [], {}, -0.01, 1000.01]) {
    const raw = JSON.stringify({
      budget,
      activeDays: ['Wo'],
      recipeByDay: { Wo: 'tikka' },
    })
    const restored = parsePlannerPreferencesWithCustomBudget(
      raw, m2InitialPlan, recipeIds,
    )
    assert.equal(restored.budget, 35, `invalid persisted budget ${String(budget)}`)
    assert.deepEqual(restored.activeDays, ['Wo'])
    assert.equal(restored.recipeByDay.Wo, 'tikka')
    const current = currentBasket(restored, m2Store, m2Products)
    assert.equal(current.selectedMealCount, 1)
    assert.ok(current.lines.length > 0)
    assert.deepEqual(
      current,
      currentBasket({ ...restored, budget: 27.5 }, m2Store, m2Products),
      'budget validation cannot add or remove physical products',
    )
  }
})

test('product #1424: a completely retired stored week cannot silently create phantom meals', () => {
  const raw = JSON.stringify({
    budget: 0.01,
    activeDays: ['Vr', 'Za'],
    recipeByDay: { Vr: 'tikka', Za: 'pasta' },
  })
  const recovered = parsePlannerPreferencesWithCustomBudget(
    raw, m2InitialPlan, recipeIds,
  )
  assert.equal(recovered.budget, 0.01)
  assert.deepEqual(recovered.activeDays, ['Ma', 'Di', 'Wo', 'Do'],
    'stale nonempty day selections recover to the canonical plan')
  assert.deepEqual(recovered.recipeByDay, {
    Ma: 'tikka', Di: 'teriyaki', Wo: 'pasta', Do: 'tikka',
  })
  const basket = currentBasket(recovered, m2Store, m2Products)
  assert.equal(basket.selectedMealCount, 4)
  assert.ok(basket.lines.length > 0)
})
