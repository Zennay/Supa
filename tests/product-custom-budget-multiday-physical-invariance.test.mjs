import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import { serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Independent PRODUCT #1424 acceptance on immutable PR #1510.
// All catalogs and prices are deterministic synthetic fixtures. This is NOT
// PLUS/DekaMarkt field evidence or authorization for a savings claim.
const recipeIds = m2Recipes.map((recipe) => recipe.id)
const defaultRecipes = Object.fromEntries(
  m2InitialPlan.map(({ day, recipeId }) => [day, recipeId]),
)
const stores = [
  [m2Store, m2Products],
  [m3CandidateStore, m3CandidateProducts],
]
const weekShapes = [
  [],
  ['Wo'],
  ['Ma', 'Do'],
  ['Ma', 'Di', 'Wo', 'Do'],
]
const budgets = [0.01, 27.5, 30, 35, 42.75, 1000]

function restore(budget, activeDays, recipeByDay = defaultRecipes) {
  return parsePlannerPreferencesWithCustomBudget(
    serializePlannerPreferences({ budget, activeDays, recipeByDay }),
    m2InitialPlan,
    recipeIds,
  )
}

function basketFor(user, store, products) {
  const plan = m2InitialPlan.map(({ day }) => ({
    day,
    recipeId: user.recipeByDay[day],
  }))
  return buildOneStoreBasket({
    store,
    products,
    plan,
    activeDays: user.activeDays,
    recipes: m2Recipes,
  })
}

test('product #1424: 48 restored budget/store/week combinations cannot change a physical shopping basket', () => {
  for (const activeDays of weekShapes) {
    for (const [store, products] of stores) {
      const original = basketFor(restore(35, activeDays), store, products)
      const pinned = JSON.stringify(original)

      for (const budget of budgets) {
        const user = restore(budget, activeDays)
        const built = basketFor(user, store, products)
        assert.equal(user.budget, budget)
        assert.deepEqual(user.activeDays, activeDays)
        assert.deepEqual(built, original,
          `budget ${budget} changed actual basket for ${store.id}/${activeDays.join(',')}`)
        assert.equal(JSON.stringify(original), pinned, 'prior basket remains immutable')

        const cost = assessPlannerBudgetCents(
          built.totalCents, user.budget, built.unresolvedLineCount,
        )
        if (built.unresolvedLineCount > 0) {
          assert.equal(cost.status, 'unknown')
          assert.equal(cost.reason, 'unresolved-products')
          assert.equal(cost.knownMinimumCents, built.totalCents)
          assert.equal('remainingCents' in cost, false)
          assert.equal('overBudget' in cost, false)
        } else {
          assert.equal(cost.status, 'known')
          assert.equal(cost.budgetCents, Math.round(budget * 100))
          assert.equal(cost.remainingCents, cost.budgetCents - built.totalCents)
          assert.equal(cost.overBudget, built.totalCents > cost.budgetCents)
        }
      }
    }
  }
})

test('product #1424: a recipe swap changes demand, but a subsequent budget edit never restores the old basket', () => {
  const initial = restore(27.5, ['Ma', 'Wo'])
  const first = basketFor(initial, m2Store, m2Products)
  const switched = restore(27.5, ['Ma', 'Wo'], {
    ...defaultRecipes,
    Wo: 'teriyaki',
  })
  const changed = basketFor(switched, m2Store, m2Products)
  assert.equal(changed.selectedMealCount, first.selectedMealCount)
  assert.notDeepEqual(changed, first, 'the actual recipe choice must affect demand')

  for (const budget of [0.01, 30, 42.75, 1000]) {
    const reloaded = restore(budget, ['Ma', 'Wo'], switched.recipeByDay)
    assert.equal(reloaded.recipeByDay.Wo, 'teriyaki')
    assert.deepEqual(basketFor(reloaded, m2Store, m2Products), changed)
    assert.notDeepEqual(basketFor(reloaded, m2Store, m2Products), first)
  }
})
