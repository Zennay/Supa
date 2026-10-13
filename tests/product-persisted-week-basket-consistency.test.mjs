import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

const recipeIds = m2Recipes.map((recipe) => recipe.id)

function basketsFor(savedPreferences) {
  const preferences = parsePlannerPreferences(
    serializePlannerPreferences(savedPreferences),
    m2InitialPlan,
    recipeIds,
  )
  const plan = m2InitialPlan.map((meal) => ({
    ...meal,
    recipeId: preferences.recipeByDay[meal.day] ?? meal.recipeId,
  }))
  const inputs = {
    plan,
    activeDays: preferences.activeDays,
    recipes: m2Recipes,
  }
  const shopping = buildOneStoreBasket({
    ...inputs,
    store: m2Store,
    products: m2Products,
  })
  const baseline = buildOneStoreBasket({
    ...inputs,
    store: m3BaselineStore,
    products: m3BaselineProducts,
  })
  const candidate = buildOneStoreBasket({
    ...inputs,
    store: m3CandidateStore,
    products: m3CandidateProducts,
  })
  return {
    preferences,
    shopping,
    baseline,
    candidate,
    comparison: compareFullBaskets({ baseline, candidate }),
  }
}

test('restored recipe/day choices feed the same demand to shopping and both comparison stores', () => {
  const preferences = {
    ...defaultPlannerPreferences(m2InitialPlan),
    budget: 40,
    activeDays: ['Do', 'Di'],
    recipeByDay: {
      Ma: 'tikka',
      Di: 'pasta',
      Wo: 'pasta',
      Do: 'teriyaki',
    },
  }

  const result = basketsFor(preferences)
  assert.deepEqual(result.preferences.activeDays, ['Di', 'Do'])
  for (const basket of [result.shopping, result.baseline, result.candidate]) {
    assert.equal(basket.selectedMealCount, 2)
    assert.deepEqual(
      basket.lines.map((line) => [line.id, line.requirement.amount, line.requirement.unit]),
      result.baseline.lines.map((line) => [line.id, line.requirement.amount, line.requirement.unit]),
    )
  }
  assert.equal(result.comparison.claimable, true)
  assert.notEqual(result.comparison.outcome, 'unknown')

  // Price differences and the selectable budget do not change physical demand.
  const differentBudget = basketsFor({ ...preferences, budget: 30 })
  assert.deepEqual(differentBudget.baseline, result.baseline)
  assert.deepEqual(differentBudget.candidate, result.candidate)
  assert.deepEqual(differentBudget.shopping, result.shopping)
  assert.equal(differentBudget.preferences.budget, 30)
})

test('a genuinely saved empty week cannot leave stale shopping checkmarks or financial differences', () => {
  const normal = basketsFor(defaultPlannerPreferences(m2InitialPlan))
  const empty = basketsFor({
    ...defaultPlannerPreferences(m2InitialPlan),
    activeDays: [],
  })

  assert.deepEqual(empty.preferences.activeDays, [])
  for (const basket of [empty.shopping, empty.baseline, empty.candidate]) {
    assert.equal(basket.selectedMealCount, 0)
    assert.equal(basket.totalCents, 0)
    assert.equal(basket.lines.length, 0)
  }
  assert.equal(empty.comparison.claimable, true)
  assert.equal(empty.comparison.outcome, 'same')
  assert.equal(empty.comparison.savingsCents, 0)
  assert.notEqual(shoppingListBasketKey(normal.shopping), shoppingListBasketKey(empty.shopping))

  const checkedId = normal.shopping.lines[0]?.id
  assert.ok(checkedId)
  const stored = serializeShoppingListProgress(normal.shopping, [checkedId])
  assert.deepEqual(restoreShoppingListProgress(normal.shopping, stored), [checkedId])
  assert.deepEqual(restoreShoppingListProgress(empty.shopping, stored), [])
})

test('an untrusted product in one comparison store yields unknown, never a saved-money claim', () => {
  const preferences = defaultPlannerPreferences(m2InitialPlan)
  const result = basketsFor(preferences)
  const candidateProducts = m3CandidateProducts.map((product) =>
    product.name.includes('Basmati')
      ? { ...product, available: false }
      : product,
  )
  const degraded = buildOneStoreBasket({
    store: m3CandidateStore,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: result.preferences.activeDays,
    products: candidateProducts,
  })
  const comparison = compareFullBaskets({
    baseline: result.baseline,
    candidate: degraded,
  })

  assert.ok(degraded.unresolvedLineCount > 0)
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.savingsCents, null)
  assert.equal(comparison.deltaCents, null)
  assert.deepEqual(comparison.lineDeltas, [])
})
