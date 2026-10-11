import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  customWeekBudgetLabel,
  parseCustomWeekBudget,
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import {
  defaultPlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
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

// #1424 product-core integration: these are controlled demo catalogs,
// NOT observed PLUS/DekaMarkt prices, M3 evidence or a public saving.
const validRecipes = m2Recipes.map((recipe) => recipe.id)

function restore(preferences) {
  return parsePlannerPreferencesWithCustomBudget(
    serializePlannerPreferences(preferences),
    m2InitialPlan,
    validRecipes,
  )
}

function plannedMeals(preferences) {
  return m2InitialPlan.map((meal) => ({
    ...meal,
    recipeId: preferences.recipeByDay[meal.day] ?? meal.recipeId,
  }))
}

function buildFor(store, products, preferences) {
  return buildOneStoreBasket({
    store,
    products,
    plan: plannedMeals(preferences),
    activeDays: preferences.activeDays,
    recipes: m2Recipes,
  })
}

function storePair(preferences) {
  const baseline = buildFor(m3BaselineStore, m3BaselineProducts, preferences)
  const candidate = buildFor(m3CandidateStore, m3CandidateProducts, preferences)
  return { baseline, candidate, comparison: compareFullBaskets({ baseline, candidate }) }
}

test('product #1424: changing only the stored week budget cannot reprice or change a full basket', () => {
  const base = {
    ...defaultPlannerPreferences(m2InitialPlan),
    activeDays: ['Di', 'Wo'],
  }
  const initialPair = storePair(base)
  const initial = JSON.stringify(initialPair)
  assert.equal(initialPair.baseline.unresolvedLineCount, 0)
  assert.equal(initialPair.candidate.unresolvedLineCount, 0)
  assert.equal(initialPair.comparison.claimable, true)

  for (const cents of [1, 2750, 3500, 4275, 99999, 100000]) {
    const restored = restore({ ...base, budget: cents / 100 })
    const pair = storePair(restored)
    assert.deepEqual(pair, initialPair, `budget ${cents}c must not change demand or quotes`)
    assert.equal(pair.comparison.publicSavingsClaimEligible, undefined)
    const assessment = assessPlannerBudgetCents(pair.baseline.totalCents, restored.budget, 0)
    assert.equal(assessment.status, 'known')
    assert.equal(assessment.budgetCents, cents)
    assert.equal(assessment.remainingCents, cents - pair.baseline.totalCents)
    assert.equal(assessment.overBudget, pair.baseline.totalCents > cents)
  }
  assert.equal(JSON.stringify(initialPair), initial)
})

test('product #1424: meal replacement and active-day edits survive custom budget restore and rebuild both stores', () => {
  const original = defaultPlannerPreferences(m2InitialPlan)
  const changed = restore({
    ...original,
    budget: parseCustomWeekBudget('27,50'),
    activeDays: ['Wo', 'Di'],
    recipeByDay: { ...original.recipeByDay, Di: 'pasta', Wo: 'teriyaki' },
  })
  assert.equal(changed.budget, 27.5)
  assert.deepEqual(changed.activeDays, ['Di', 'Wo'])
  assert.equal(changed.recipeByDay.Di, 'pasta')
  assert.equal(changed.recipeByDay.Wo, 'teriyaki')

  const pair = storePair(changed)
  assert.equal(pair.baseline.selectedMealCount, 2)
  assert.equal(pair.candidate.selectedMealCount, 2)
  assert.equal(pair.baseline.unresolvedLineCount, 0)
  assert.equal(pair.candidate.unresolvedLineCount, 0)
  assert.equal(pair.comparison.claimable, true)
  assert.equal(
    pair.comparison.deltaCents,
    pair.candidate.totalCents - pair.baseline.totalCents,
  )
  assert.equal(
    pair.comparison.savingsCents,
    -pair.comparison.deltaCents || 0,
  )

  const budget = assessPlannerBudgetCents(pair.baseline.totalCents, changed.budget, 0)
  assert.equal(budget.status, 'known')
  assert.equal(budget.remainingCents, 2750 - pair.baseline.totalCents)
  // A budget edit must not rewrite recipe choices or a prior basket.
  const originalPair = JSON.stringify(pair)
  const next = restore({ ...changed, budget: 42.75 })
  assert.deepEqual(next.activeDays, ['Di', 'Wo'])
  assert.deepEqual(next.recipeByDay, changed.recipeByDay)
  assert.equal(JSON.stringify(pair), originalPair)
  assert.deepEqual(storePair(next), pair)
})

test('product #1424: unmatched demo ingredient remains a minimum-only planner cost at any custom budget', () => {
  const user = restore({
    ...defaultPlannerPreferences(m2InitialPlan),
    budget: 27.5,
    activeDays: ['Ma'],
  })
  const basket = buildFor(m2Store, m2Products, user)
  assert.equal(basket.selectedMealCount, 1)
  assert.ok(basket.unresolvedLineCount >= 1, 'demo store omits garam masala')
  const assessment = assessPlannerBudgetCents(
    basket.totalCents,
    user.budget,
    basket.unresolvedLineCount,
  )
  assert.equal(assessment.status, 'unknown')
  assert.equal(assessment.reason, 'unresolved-products')
  assert.equal(assessment.knownMinimumCents, basket.totalCents)
  assert.equal(assessment.budgetCents, 2750)
  assert.equal('remainingCents' in assessment, false)
  assert.equal('overBudget' in assessment, false)

  const selected = restore({ ...user, budget: 0.01 })
  const tiny = assessPlannerBudgetCents(basket.totalCents, selected.budget, basket.unresolvedLineCount)
  assert.equal(tiny.status, 'unknown')
  assert.equal(tiny.knownMinimumCents, basket.totalCents)
  assert.equal('overBudget' in tiny, false)
})

test('product #1424: an observed-between-renders one-cent product price change updates the basket without losing the budget', () => {
  const base = {
    ...defaultPlannerPreferences(m2InitialPlan),
    activeDays: ['Wo'],
  }
  const initial = buildFor(m2Store, m2Products, base)
  assert.equal(initial.unresolvedLineCount, 0)
  assert.ok(initial.totalCents > 0 && initial.totalCents <= 100000)

  const fixed = restore({
    ...base,
    budget: parseCustomWeekBudget(customWeekBudgetLabel(initial.totalCents / 100)),
  })
  const before = buildFor(m2Store, m2Products, fixed)
  const beforeSaved = JSON.stringify(before)
  const prior = assessPlannerBudgetCents(before.totalCents, fixed.budget, 0)
  assert.equal(prior.status, 'known')
  assert.equal(prior.remainingCents, 0)

  const priced = before.lines.find((line) => line.status === 'matched')
  assert.ok(priced)
  const changedProducts = m2Products.map((product) =>
    product.id === priced.productId
      ? { ...product, priceCents: product.priceCents + 1 }
      : product,
  )
  const current = buildFor(m2Store, changedProducts, fixed)
  assert.equal(current.unresolvedLineCount, 0)
  assert.equal(current.totalCents, before.totalCents + priced.packs)
  const after = assessPlannerBudgetCents(current.totalCents, fixed.budget, 0)
  assert.equal(after.status, 'known')
  assert.equal(after.remainingCents, -priced.packs)
  assert.equal(after.overBudget, true)
  assert.equal(after.remainingLabel.includes('—'), false)
  assert.equal(JSON.stringify(before), beforeSaved, 'previous basket remains unchanged')
  assert.deepEqual(restore(fixed), fixed, 'the user budget and plan remain saved')
})
