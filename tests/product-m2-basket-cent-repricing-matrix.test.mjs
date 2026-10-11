import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

const store = { id: 'cent-matrix-store', name: 'Controlewinkel' }
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
  priceCents: 100,
}

function assess(priceCents, days, budgetEuros) {
  const basket = buildOneStoreBasket({
    store,
    plan: days.map((day) => ({ day, recipeId: recipe.id })),
    recipes: [recipe],
    activeDays: days,
    products: [{ ...product, priceCents }],
  })
  return {
    basket,
    assessment: assessPlannerBudgetCents(
      basket.totalCents,
      budgetEuros,
      basket.unresolvedLineCount,
    ),
  }
}

test('M2 basket price matrix preserves exact cent labels and overspend flags', () => {
  let cases = 0
  for (const budgetEuros of [30, 35, 40]) {
    for (let priceCents = 0; priceCents <= 5000; priceCents += 37) {
      const { basket, assessment } = assess(priceCents, ['Ma'], budgetEuros)
      assert.equal(basket.unresolvedLineCount, 0, String(priceCents))
      assert.equal(basket.totalCents, priceCents)
      assert.equal(assessment.status, 'known')
      assert.equal(assessment.remainingCents, budgetEuros * 100 - priceCents)
      assert.equal(assessment.remainingLabel, euro.formatCents(budgetEuros * 100 - priceCents))
      assert.equal(assessment.overBudget, priceCents > budgetEuros * 100)
      assert.notEqual(assessment.remainingLabel, '—')
      cases += 1
    }
  }
  assert.equal(cases, 408)
})

test('M2 ingredient reuse applies two pack prices before cent-exact subtraction', () => {
  let cases = 0
  for (let priceCents = 0; priceCents <= 2000; priceCents += 23) {
    const { basket, assessment } = assess(priceCents, ['Ma', 'Di'], 35)
    assert.equal(basket.unresolvedLineCount, 0)
    assert.equal(basket.lines.length, 1)
    assert.equal(basket.lines[0].packs, 2)
    assert.equal(basket.totalCents, 2 * priceCents)
    assert.equal(assessment.status, 'known')
    assert.equal(assessment.remainingCents, 3500 - 2 * priceCents)
    assert.equal(assessment.overBudget, 2 * priceCents > 3500)
    cases += 1
  }
  assert.equal(cases, 87)
})

test('untrusted product cents do not produce an affordable-week claim', () => {
  for (const invalidPrice of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { basket, assessment } = assess(invalidPrice, ['Ma'], 35)
    assert.equal(basket.unresolvedLineCount, 1)
    assert.equal(basket.totalCents, 0)
    assert.equal(assessment.status, 'unknown')
    assert.equal(assessment.reason, 'unresolved-products')
    assert.equal('remainingCents' in assessment, false)
  }
})
