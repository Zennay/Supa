import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSingleStoreBasket,
  shoppingListFromBasket,
} from '../src/domain/basket.ts'
import {
  m2DekaMarktObservations,
  m2Plan,
  m2Recipes,
} from '../src/data/m2DeterministicFixture.ts'

test('M2 builds one deterministic DekaMarkt basket from two planned recipe occurrences', () => {
  const basket = buildSingleStoreBasket({
    supermarket: 'dekamarkt',
    plan: m2Plan,
    activeDays: ['Ma', 'Do'],
    recipes: m2Recipes,
    observations: m2DekaMarktObservations,
  })

  assert.equal(basket.complete, true)
  assert.equal(basket.lines.length, 3)
  assert.equal(basket.totalCents, 558)

  const milk = basket.lines.find(
    (line) => line.ingredient.id === 'halfvolle-melk',
  )
  assert.ok(milk)
  assert.equal(milk.status, 'matched')
  assert.equal(milk.ingredient.amount, 2000)
  assert.equal(milk.ingredient.occurrences, 2)
  assert.equal(milk.product.sourceProductId, '115873')
  assert.equal(milk.packs, 2)
  assert.equal(milk.linePriceCents, 170)
  assert.equal(
    milk.trace.provenance.sha256,
    '6666d3ed68bee4306bae95be7a7acf3e5867649cc79a5e6e2c80e7eb08c60a1d',
  )
})

test('M2 basket is reproducible for the same plan and versioned evidence', () => {
  const input = {
    supermarket: 'dekamarkt',
    plan: m2Plan,
    activeDays: ['Ma', 'Do'],
    recipes: m2Recipes,
    observations: m2DekaMarktObservations,
  }

  assert.deepEqual(buildSingleStoreBasket(input), buildSingleStoreBasket(input))
})

test('inactive planner days do not contribute ingredients or packs', () => {
  const basket = buildSingleStoreBasket({
    supermarket: 'dekamarkt',
    plan: m2Plan,
    activeDays: ['Ma'],
    recipes: m2Recipes,
    observations: m2DekaMarktObservations,
  })

  const milk = basket.lines.find(
    (line) => line.ingredient.id === 'halfvolle-melk',
  )
  assert.ok(milk)
  assert.equal(milk.status, 'matched')
  assert.equal(milk.ingredient.amount, 1000)
  assert.equal(milk.ingredient.occurrences, 1)
  assert.equal(milk.packs, 1)
  assert.equal(basket.totalCents, 473)
})

test('shopping list is derived from the exact basket and carries uncertainty trace', () => {
  const basket = buildSingleStoreBasket({
    supermarket: 'dekamarkt',
    plan: m2Plan,
    activeDays: ['Ma', 'Do'],
    recipes: m2Recipes,
    observations: m2DekaMarktObservations,
  })
  const list = shoppingListFromBasket(basket)

  assert.equal(list.length, 3)
  assert.ok(list.every((item) => item.priceCents !== null))
  assert.ok(list.every((item) => item.needsReview))
  assert.ok(
    list.every((item) =>
      item.trace.some((entry) =>
        entry.includes('availability unknown in bounded source evidence'),
      ),
    ),
  )
})

test('M2 exposes an unmatched ingredient instead of inventing a basket product', () => {
  const recipes = [
    ...m2Recipes,
    {
      id: 'yoghurt-test',
      title: 'Yoghurt test',
      ingredients: [
        {
          id: 'griekse-yoghurt',
          label: 'Griekse yoghurt',
          query: 'Griekse yoghurt',
          amount: 500,
          unit: 'g',
        },
      ],
    },
  ]
  const basket = buildSingleStoreBasket({
    supermarket: 'dekamarkt',
    plan: [...m2Plan, { day: 'Vr', recipeId: 'yoghurt-test' }],
    activeDays: ['Ma', 'Do', 'Vr'],
    recipes,
    observations: m2DekaMarktObservations,
  })

  assert.equal(basket.complete, false)
  const unresolved = basket.lines.find(
    (line) => line.ingredient.id === 'griekse-yoghurt',
  )
  assert.ok(unresolved)
  assert.equal(unresolved.status, 'unresolved')
  assert.equal(unresolved.trace.match.type, 'abstain')

  const reviewItem = shoppingListFromBasket(basket).find(
    (item) => item.id === 'review-griekse-yoghurt',
  )
  assert.ok(reviewItem)
  assert.equal(reviewItem.priceCents, null)
  assert.equal(reviewItem.needsReview, true)
  assert.equal(reviewItem.trace[0], 'Geen betrouwbaar product gekozen.')
})

test('duplicate observations for a selected source product fail closed', () => {
  const basket = buildSingleStoreBasket({
    supermarket: 'dekamarkt',
    plan: [{ day: 'Ma', recipeId: 'banana-nutella-shake' }],
    activeDays: ['Ma'],
    recipes: m2Recipes,
    observations: [
      ...m2DekaMarktObservations,
      { ...m2DekaMarktObservations[0] },
    ],
  })

  const milk = basket.lines.find(
    (line) => line.ingredient.id === 'halfvolle-melk',
  )
  assert.ok(milk)
  assert.equal(milk.status, 'unresolved')
  assert.ok(
    milk.trace.warnings.includes('matched product has duplicate observations'),
  )
})
