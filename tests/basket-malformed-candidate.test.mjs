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

function buildWithOnlyChicken(chicken) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: [m2InitialPlan[0]],
    recipes: oneIngredientRecipe(),
    activeDays: ['Ma'],
    products: [chicken],
  })
}

test('basket construction excludes malformed catalog candidate names before matching', () => {
  for (const invalidName of ['', '   ', null, 42]) {
    const chicken = structuredClone(m2Products[0])
    chicken.name = invalidName

    const basket = buildWithOnlyChicken(chicken)

    assert.equal(basket.lines.length, 1)
    assert.equal(basket.lines[0].status, 'unresolved')
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 1)
  }
})

test('basket construction excludes non-object catalog entries before matching', () => {
  for (const invalidCandidate of [null, undefined]) {
    const basket = buildOneStoreBasket({
      store: m2Store,
      plan: [m2InitialPlan[0]],
      recipes: oneIngredientRecipe(),
      activeDays: ['Ma'],
      products: [invalidCandidate],
    })

    assert.equal(basket.lines.length, 1)
    assert.equal(basket.lines[0].status, 'unresolved')
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 1)
  }
})

test('basket construction excludes malformed catalog candidate identities before matching', () => {
  for (const invalidId of ['', '   ', null, 42]) {
    const chicken = structuredClone(m2Products[0])
    chicken.id = invalidId

    const basket = buildWithOnlyChicken(chicken)

    assert.equal(basket.lines.length, 1)
    assert.equal(basket.lines[0].status, 'unresolved')
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 1)
  }
})
