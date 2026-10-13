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
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

const recipeIds = m2Recipes.map((recipe) => recipe.id)

function derived(saved) {
  const preferences = parsePlannerPreferences(
    serializePlannerPreferences(saved), m2InitialPlan, recipeIds,
  )
  const plan = m2InitialPlan.map((entry) => ({
    ...entry, recipeId: preferences.recipeByDay[entry.day] ?? entry.recipeId,
  }))
  const common = { plan, activeDays: preferences.activeDays, recipes: m2Recipes }
  const shopping = buildOneStoreBasket({ ...common, store: m2Store, products: m2Products })
  const baseline = buildOneStoreBasket({
    ...common, store: m3BaselineStore, products: m3BaselineProducts,
  })
  const candidate = buildOneStoreBasket({
    ...common, store: m3CandidateStore, products: m3CandidateProducts,
  })
  return { preferences, shopping, baseline, candidate, comparison: compareFullBaskets({ baseline, candidate }) }
}

function unknownWithoutSavings(comparison) {
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.deepEqual(comparison.lineDeltas, [])
  assert.match(comparison.reasons.join(' '), /no planned meals or basket ingredients/)
}

test('independent #1051: persisted empty week keeps zero-line shopping without inventing a store comparison', () => {
  const saved = { ...defaultPlannerPreferences(m2InitialPlan), activeDays: [] }
  const before = structuredClone(saved)
  const result = derived(saved)
  assert.deepEqual(result.preferences.activeDays, [])
  for (const basket of [result.shopping, result.baseline, result.candidate]) {
    assert.equal(basket.selectedMealCount, 0)
    assert.equal(basket.totalCents, 0)
    assert.deepEqual(basket.lines, [])
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 0)
  }
  unknownWithoutSavings(result.comparison)
  assert.deepEqual(saved, before, 'comparison must not change persisted planner preferences')
})

test('independent #1051: old checked products do not reappear in a saved zero-day basket', () => {
  const originalPreferences = defaultPlannerPreferences(m2InitialPlan)
  const normal = derived(originalPreferences)
  const id = normal.shopping.lines.find((line) => line.status === 'matched')?.id
  assert.ok(id)
  const checked = serializeShoppingListProgress(normal.shopping, [id])
  assert.deepEqual(restoreShoppingListProgress(normal.shopping, checked), [id])

  const empty = derived({ ...originalPreferences, activeDays: [], budget: 40 })
  assert.notEqual(shoppingListBasketKey(normal.shopping), shoppingListBasketKey(empty.shopping))
  assert.deepEqual(restoreShoppingListProgress(empty.shopping, checked), [])
  unknownWithoutSavings(empty.comparison)

  const resumed = derived({ ...originalPreferences, activeDays: ['Di', 'Do'], budget: 40 })
  assert.ok(resumed.shopping.lines.length > 0)
  assert.ok(resumed.baseline.lines.length > 0)
  assert.ok(resumed.candidate.lines.length > 0)
  assert.notEqual(shoppingListBasketKey(empty.shopping), shoppingListBasketKey(resumed.shopping))
})

test('independent #1051: restored nonempty same-demand week remains financially comparable', () => {
  const saved = {
    ...defaultPlannerPreferences(m2InitialPlan),
    activeDays: ['Do', 'Di'],
    recipeByDay: { Ma: 'tikka', Di: 'pasta', Wo: 'pasta', Do: 'teriyaki' },
  }
  const result = derived(saved)
  assert.deepEqual(result.preferences.activeDays, ['Di', 'Do'])
  for (const basket of [result.shopping, result.baseline, result.candidate]) {
    assert.equal(basket.selectedMealCount, 2)
    assert.ok(basket.lines.length > 0)
    assert.deepEqual(
      basket.lines.map((line) => [line.id, line.requirement.amount, line.requirement.unit]),
      result.baseline.lines.map((line) => [line.id, line.requirement.amount, line.requirement.unit]),
    )
  }
  assert.equal(result.comparison.claimable, true)
  assert.notEqual(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.reasons.length, 0)
  assert.equal(result.comparison.savingsCents !== null, true)
  // A budget preference alone must not alter the physical week/financial comparison.
  const budgetOnly = derived({ ...saved, budget: 30 })
  assert.deepEqual(budgetOnly.baseline, result.baseline)
  assert.deepEqual(budgetOnly.candidate, result.candidate)
  assert.deepEqual(budgetOnly.comparison, result.comparison)
})
