import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'

// Controlled end-to-end #1402 recipe -> aggregation -> match -> physical
// pack -> exact cent trace. No current price or real retailer claim.
const store = Object.freeze({ id: 'test-grocery', name: 'Controlewinkel (demo)' })
const count = 2_000
const ingredients = Object.freeze(Array.from({ length: count }, (_, index) =>
  Object.freeze({
    id: 'basmati-rice',
    label: 'Basmati rijst',
    query: 'basmati rijst',
    amount: index % 2 === 0 ? 0.05 : 0.00005,
    unit: index % 2 === 0 ? 'g' : 'kg',
  }),
))
const recipes = Object.freeze([Object.freeze({
  id: 'rice-plan',
  title: 'Gecontroleerde rijst',
  minutes: 10,
  servings: 1,
  estimatedCost: 0,
  tags: Object.freeze([]),
  ingredients,
})])
const plan = Object.freeze([Object.freeze({ day: 'Ma', recipeId: 'rice-plan' })])
const activeDays = Object.freeze(['Ma'])

function basket(packAmount) {
  return buildOneStoreBasket({
    store,
    plan,
    recipes,
    activeDays,
    products: [Object.freeze({
      id: 'basmati-controlled-pack',
      storeId: store.id,
      name: 'Basmati rijst',
      packAmount,
      packUnit: 'g',
      available: true,
      priceCents: 249,
    })],
  })
}

test('2,000 mixed-unit ingredient appearances become one matched 100g basket line', () => {
  const result = basket(100)
  assert.equal(result.selectedMealCount, 1)
  assert.equal(result.lines.length, 1, 'ingredient reuse must not duplicate shopping rows')
  assert.equal(result.matchedLineCount, 1)
  assert.equal(result.unresolvedLineCount, 0)
  assert.equal(result.totalCents, 249)
  assert.equal(result.lines[0].status, 'matched')
  assert.equal(result.lines[0].requirement.amount, 100)
  assert.equal(result.lines[0].requirement.unit, 'g')
  assert.equal(result.lines[0].packs, 1)
  assert.equal(result.lines[0].lineTotalCents, 249)
})

test('100g exact need versus 99.99g pack must buy two, not silently round down', () => {
  const result = basket(99.99)
  assert.equal(result.unresolvedLineCount, 0)
  assert.equal(result.lines[0].status, 'matched')
  assert.equal(result.lines[0].packs, 2)
  assert.equal(result.lines[0].lineTotalCents, 498)
  assert.equal(result.totalCents, 498)
  assert.equal(ingredients.length, count)
  assert.equal(ingredients[0].amount, 0.05)
  assert.equal(ingredients[1].amount, 0.00005)
})

test('removing the planned day produces an empty zero-cost basket', () => {
  const result = buildOneStoreBasket({
    store,
    plan,
    recipes,
    activeDays: [],
    products: [{
      id: 'basmati-controlled-pack', storeId: store.id, name: 'Basmati rijst',
      packAmount: 100, packUnit: 'g', available: true, priceCents: 249,
    }],
  })
  assert.equal(result.selectedMealCount, 0)
  assert.deepEqual(result.lines, [])
  assert.equal(result.totalCents, 0)
})
