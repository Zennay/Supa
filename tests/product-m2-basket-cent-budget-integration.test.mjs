import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

const store = { id: 'controlled-store', name: 'Testwinkel' }
const recipe = {
  id: 'rice',
  title: 'Rijst',
  minutes: 10,
  servings: 1,
  estimatedCost: 1,
  tags: [],
  ingredients: [{ id: 'rice', label: 'Basmati rijst', query: 'basmati rijst', amount: 150, unit: 'g' }],
}
const product = {
  id: 'basmati-250',
  storeId: store.id,
  name: 'Basmati rijst 250 g',
  packAmount: 250,
  packUnit: 'g',
  available: true,
  priceCents: 1969,
}

function basket(products = [product], days = ['Ma']) {
  return buildOneStoreBasket({
    store,
    plan: days.map((day) => ({ day, recipeId: recipe.id })),
    recipes: [recipe],
    activeDays: days,
    products,
  })
}

test('complete M2 basket yields cent-exact budget remainder instead of floating drift', () => {
  const result = basket()
  assert.equal(result.unresolvedLineCount, 0)
  assert.equal(result.totalCents, 1969)
  const budget = assessPlannerBudgetCents(result.totalCents, 35, result.unresolvedLineCount)
  assert.equal(budget.status, 'known')
  assert.equal(budget.remainingCents, 1531)
  assert.equal(budget.remainingLabel, euro.formatCents(1531))
  assert.equal(budget.overBudget, false)
})

test('repricing a physically identical product adjusts only the exact remaining cents', () => {
  const before = basket()
  const after = basket([{ ...product, priceCents: 2001 }])
  assert.equal(after.unresolvedLineCount, 0)
  assert.equal(after.lines[0].productId, before.lines[0].productId)
  assert.deepEqual(after.lines[0].requirement, before.lines[0].requirement)
  const oldBudget = assessPlannerBudgetCents(before.totalCents, 35, 0)
  const newBudget = assessPlannerBudgetCents(after.totalCents, 35, 0)
  assert.equal(oldBudget.status, 'known')
  assert.equal(newBudget.status, 'known')
  assert.equal(oldBudget.remainingCents - newBudget.remainingCents, 32)
  assert.equal(newBudget.remainingCents, 1499)
  assert.equal(newBudget.remainingLabel, euro.formatCents(1499))
})

test('ingredient reuse purchases physical packs before computing the budget', () => {
  const result = basket([{ ...product, priceCents: 199 }], ['Ma', 'Di'])
  assert.equal(result.unresolvedLineCount, 0)
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].requirement.amount, 300)
  assert.equal(result.lines[0].packs, 2)
  assert.equal(result.totalCents, 398)
  const budget = assessPlannerBudgetCents(result.totalCents, 3, 0)
  assert.equal(budget.status, 'known')
  assert.equal(budget.remainingCents, -98)
  assert.equal(budget.overBudget, true)
  assert.equal(budget.remainingLabel, euro.formatCents(-98))
})

test('missing product must not become an apparently free shopping week', () => {
  const result = basket([])
  assert.equal(result.totalCents, 0)
  assert.equal(result.unresolvedLineCount, 1)
  const budget = assessPlannerBudgetCents(result.totalCents, 35, result.unresolvedLineCount)
  assert.deepEqual(budget, {
    status: 'unknown',
    reason: 'unresolved-products',
    budgetCents: 3500,
    knownMinimumCents: 0,
    unresolvedLineCount: 1,
  })
  assert.equal('remainingLabel' in budget, false)
  assert.equal('overBudget' in budget, false)
})

test('frozen M2 fixture week produces a consistent non-mutating budget assessment', () => {
  const before = JSON.stringify({ m2InitialPlan, m2Products, m2Recipes })
  const result = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2InitialPlan.map(({ day }) => day),
    products: m2Products,
  })
  assert.equal(
    result.totalCents,
    result.lines
      .filter((line) => line.status === 'matched')
      .reduce((total, line) => total + line.lineTotalCents, 0),
  )
  const budget = assessPlannerBudgetCents(result.totalCents, 35, result.unresolvedLineCount)
  if (result.unresolvedLineCount > 0) {
    assert.equal(budget.status, 'unknown')
    assert.equal('remainingCents' in budget, false)
  } else {
    assert.equal(budget.status, 'known')
    assert.equal(budget.remainingCents, 3500 - result.totalCents)
    assert.equal(budget.remainingLabel, euro.formatCents(3500 - result.totalCents))
  }
  assert.equal(JSON.stringify({ m2InitialPlan, m2Products, m2Recipes }), before)
})
