import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2InitialPlan, m2Recipes, m2DefaultActiveDays, m2Products,
} from '../src/data/m2Fixture.ts'

// M2 4-meal / 11-demand integration; these are synthetic prices only.
function normalizedRecipes(tikkaUnit, teriyakiUnit) {
  return m2Recipes.map(recipe => ({
    ...recipe,
    ingredients: recipe.ingredients.map(ingredient => {
      if (ingredient.id !== 'basmati-rice') return { ...ingredient }
      const unit = recipe.id === 'tikka' ? tikkaUnit : teriyakiUnit
      return { ...ingredient, unit, amount: unit === 'kg' ? 0.15 : 150 }
    }),
  }))
}
function storeBasket(storeId, recipes, increment = 0, withGaram = true) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
    priceCents: product.priceCents + increment,
  }))
  if (withGaram) products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true,
    priceCents: 139 + increment,
  })
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes, activeDays: m2DefaultActiveDays, products,
  })
}
function pair(increment = 0, withGaram = true) {
  const baseline = storeBasket('controlled-plus', normalizedRecipes('g', 'kg'))
  const candidate = storeBasket('controlled-dekamarkt', normalizedRecipes('kg', 'g'), increment, withGaram)
  assert.equal(baseline.lines.length, 11)
  assert.equal(candidate.lines.length, 11)
  const baselineRice = baseline.lines.find(x => x.id === 'basmati-rice')
  const candidateRice = candidate.lines.find(x => x.id === 'basmati-rice')
  assert.deepEqual(baselineRice.requirement, { amount: 450, unit: 'g' })
  assert.deepEqual(candidateRice.requirement, { amount: 0.45, unit: 'kg' })
  return { baseline, candidate }
}

test('M2 mixed recipe units compose into M3 11-demand two-store same basket', () => {
  const input = pair()
  const before = structuredClone(input)
  const result = compareFullBaskets(input)
  assert.equal(input.baseline.matchedLineCount, 11)
  assert.equal(input.candidate.matchedLineCount, 11)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.deepEqual(input, before)
})

test('M2 mixed recipe units compose into M3 weighted one-cent-per-pack worse result', () => {
  const input = pair(1)
  const expectedDelta = input.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const result = compareFullBaskets(input)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expectedDelta)
  assert.equal(result.savingsCents, -expectedDelta)
  assert.equal(result.lineDeltas.length, 11)
})

test('M2/M3 mixed unit plan never turns an unresolved ingredient into a savings claim', () => {
  const input = pair(0, false)
  assert.ok(input.candidate.unresolvedLineCount > 0)
  const result = compareFullBaskets(input)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
})
