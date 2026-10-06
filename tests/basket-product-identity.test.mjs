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
    /store catalog contains no product with a trusted identity/,
  )
})


test('basket rejects blank ingredient identities before aggregation', () => {
  const invalidRecipes = [
    {
      ...recipes[0],
      ingredients: [
        {
          ...recipes[0].ingredients[0],
          id: '   ',
        },
      ],
    },
  ]

  assert.throws(
    () =>
      buildOneStoreBasket({
        store,
        plan,
        recipes: invalidRecipes,
        activeDays: ['Ma'],
        products: [
          {
            id: 'basmati-150',
            storeId: store.id,
            name: 'Basmati rijst',
            packAmount: 150,
            packUnit: 'g',
            available: true,
            priceCents: 149,
          },
        ],
      }),
    /Ingredient identity must be non-blank/,
  )
})


test('basket rejects a blank store identity before calculation', () => {
  assert.throws(
    () =>
      buildOneStoreBasket({
        store: { id: '   ', name: 'Unnamed store' },
        plan,
        recipes,
        activeDays: ['Ma'],
        products: [
          {
            id: 'basmati-150',
            storeId: '   ',
            name: 'Basmati rijst',
            packAmount: 150,
            packUnit: 'g',
            available: true,
            priceCents: 149,
          },
        ],
      }),
    /Store identity must be non-blank/,
  )
})


test('basket fails closed when the selected product name is blank', () => {
  const basket = buildOneStoreBasket({
    store,
    plan,
    recipes,
    activeDays: ['Ma'],
    products: [
      {
        id: 'basmati-150',
        storeId: store.id,
        name: '   ',
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
    /store catalog contains no product with a trusted name/,
  )
})


test('basket does not crash on a non-string product name at runtime', () => {
  const basket = buildOneStoreBasket({
    store,
    plan,
    recipes,
    activeDays: ['Ma'],
    products: [
      {
        id: 'basmati-150',
        storeId: store.id,
        name: null,
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
    /store catalog contains no product with a trusted name/,
  )
})


test('basket does not crash on a non-string product identity at runtime', () => {
  const basket = buildOneStoreBasket({
    store,
    plan,
    recipes,
    activeDays: ['Ma'],
    products: [
      {
        id: null,
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
    /store catalog contains no product with a trusted identity/,
  )
})
