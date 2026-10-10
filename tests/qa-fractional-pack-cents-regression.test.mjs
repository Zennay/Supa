import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'

// Financial consequence of fractional rounding is independently checked from
// the aggregate amount test, so one early assertion cannot mask another bug.
// Strictly synthetic price fixture; no observed supermarket savings.
const store = { id: 'qa-fractional-cent-repro', name: 'Voorbeeldwinkel' }
const product = {
  id: 'micro-pack', storeId: store.id, name: 'testingredient',
  packAmount: 0.3, packUnit: 'g', priceCents: 199, available: true,
}
function basket(first, second) {
  const recipes = [first, second].map((amount, index) => ({
    id: `recipe-${index}`, title: 'Recept', minutes: 5, servings: 1,
    estimatedCost: 1.99, tags: [],
    ingredients: [{
      id: 'one-spice', label: 'Testingrediënt', query: 'testingredient',
      amount, unit: 'g',
    }],
  }))
  return buildOneStoreBasket({
    store, recipes, products: [product],
    plan: [
      { day: 'Ma', recipeId: 'recipe-0' },
      { day: 'Di', recipeId: 'recipe-1' },
    ],
    activeDays: ['Ma', 'Di'],
  })
}

test('financial regression: two decimal meal portions must not double €1.99 pack cost', () => {
  const value = basket(0.1, 0.2)
  assert.equal(value.selectedMealCount, 2)
  assert.equal(value.matchedLineCount, 1)
  assert.equal(value.unresolvedLineCount, 0)
  assert.equal(value.totalCents, 199,
    '0.1 g + 0.2 g is 0.3 g: exact-fit 0.3 g pack costs 199c, not 398c')
})

test('physical regression: fractional reused ingredient uses exactly one whole pack', () => {
  const value = basket(0.1, 0.2)
  assert.equal(value.lines.length, 1)
  assert.equal(value.lines[0].status, 'matched')
  assert.equal(value.lines[0].packs, 1,
    'never purchase two physical 0.3 g packs for precisely 0.3 g demand')
})

test('safety control: a real amount above the pack boundary still purchases two packs', () => {
  const value = basket(0.1, 0.2001)
  assert.equal(value.totalCents, 398)
  assert.equal(value.lines[0].packs, 2)
})

test('positive control: two exactly representable decimals still purchase one pack', () => {
  const value = basket(0.15, 0.15)
  assert.equal(value.totalCents, 199)
  assert.equal(value.lines[0].packs, 1)
})
