import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

function oneIngredientRecipe() {
  return [{
    ...structuredClone(m2Recipes[0]),
    ingredients: [structuredClone(m2Recipes[0].ingredients[0])],
  }]
}

test('basket construction excludes malformed catalog candidate names before matching', () => {
  const chicken = structuredClone(m2Products[0])
  chicken.name = null

  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: [m2InitialPlan[0]],
    recipes: oneIngredientRecipe(),
    activeDays: ['Ma'],
    products: [chicken],
  })

  assert.equal(basket.lines.length, 1)
  assert.equal(basket.lines[0].status, 'unresolved')
  assert.equal(basket.matchedLineCount, 0)
  assert.equal(basket.unresolvedLineCount, 1)
})

test('basket construction excludes malformed catalog candidate identities before matching', () => {
  const chicken = structuredClone(m2Products[0])
  chicken.id = 42

  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: [m2InitialPlan[0]],
    recipes: oneIngredientRecipe(),
    activeDays: ['Ma'],
    products: [chicken],
  })

  assert.equal(basket.lines.length, 1)
  assert.equal(basket.lines[0].status, 'unresolved')
  assert.equal(basket.matchedLineCount, 0)
  assert.equal(basket.unresolvedLineCount, 1)
})
