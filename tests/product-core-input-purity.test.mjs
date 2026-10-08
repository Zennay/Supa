import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

function basketFor({ plan = m2InitialPlan, activeDays = m2DefaultActiveDays, recipes = m2Recipes, products = m2Products } = {}) {
  return buildOneStoreBasket({
    store: m2Store,
    plan,
    activeDays,
    recipes,
    products,
  })
}

test('basket identity and cents are invariant under input collection ordering', () => {
  const baseline = basketFor()
  const reversed = basketFor({
    plan: [...m2InitialPlan].reverse(),
    activeDays: [...m2DefaultActiveDays].reverse(),
    recipes: [...m2Recipes].reverse(),
    products: [...m2Products].reverse(),
  })

  // Same frozen demand must not depend on array insertion or display order.
  assert.deepEqual(reversed, baseline)
  assert.deepEqual(
    aggregatePlanIngredients([...m2InitialPlan].reverse(), [...m2Recipes].reverse(), [...m2DefaultActiveDays].reverse()),
    aggregatePlanIngredients(m2InitialPlan, m2Recipes, m2DefaultActiveDays),
  )
})

test('building the basket does not mutate caller-owned source snapshots', () => {
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  const products = structuredClone(m2Products)
  const activeDays = structuredClone(m2DefaultActiveDays)
  const snapshots = {
    plan: structuredClone(plan),
    recipes: structuredClone(recipes),
    products: structuredClone(products),
    activeDays: structuredClone(activeDays),
  }

  basketFor({ plan, recipes, products, activeDays })

  assert.deepEqual({ plan, recipes, products, activeDays }, snapshots)
})
