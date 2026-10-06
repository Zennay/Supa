import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'

const store = { id: 'store-a', name: 'Store A' }
const plan = [{ day: 'Ma', recipeId: 'rice' }]
const recipes = [
  {
    id: 'rice',
    title: 'Rice',
    minutes: 10,
    servings: 1,
    estimatedCost: 1,
    tags: [],
    ingredients: [
      {
        id: 'basmati-rice',
        label: 'Basmati rijst',
        query: 'basmati rijst',
        amount: 100,
        unit: 'g',
      },
    ],
  },
]

test('basket fails closed when the selected product identity is blank', () => {
  const basket = buildOneStoreBasket({
    store,
    plan,
    recipes,
    activeDays: ['Ma'],
    products: [
      {
        id: '   ',
        storeId: store.id,
        name: 'Basmati rijst',
        packAmount: 150,
        packUnit: 'g',
        available: true,
        priceCents: 149,
      },
    ],
  })

  assert.equal(basket.matchedLineCount, 0)
  assert.equal(basket.unresolvedLineCount, 1)
  assert.equal(basket.totalCents, 0)
  assert.equal(basket.lines[0].status, 'unresolved')
  assert.match(
    basket.lines[0].reasons.join(' '),
    /matched product identity is blank or malformed/,
  )
})
