import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Synthetic product fixture exercise: never evidence of real retailer prices.
const stores = [
  { store: m3BaselineStore, products: m3BaselineProducts },
  { store: m3CandidateStore, products: m3CandidateProducts },
]

const sharedProducts = [
  ...m3CandidateProducts,
  ...m3BaselineProducts,
  ...m3CandidateProducts.map((product) => ({
    ...product,
    storeId: 'unselected-third-store',
    available: true,
    priceCents: 0,
  })),
].reverse()

function makeBasket(store, products, plan, activeDays) {
  return buildOneStoreBasket({
    store,
    products,
    plan,
    activeDays,
    recipes: m2Recipes,
  })
}

test('product M3: an inactive meal edit and mixed catalog churn preserve both store checklists', () => {
  const originallyActive = ['Ma', 'Wo']
  const editedPlan = m2InitialPlan.map((meal) =>
    meal.day === 'Do' ? { ...meal, recipeId: 'pasta' } : meal,
  )

  const originalBaskets = stores.map(({ store, products }) =>
    makeBasket(store, products, m2InitialPlan, originallyActive),
  )
  const saved = originalBaskets.map((basket) => {
    const ids = basket.lines.filter((line) => line.status === 'matched')
      .slice(0, 2).map((line) => line.id)
    assert.equal(ids.length, 2)
    return { ids, raw: serializeShoppingListProgress(basket, ids) }
  })
  const originalComparison = compareFullBaskets({
    baseline: originalBaskets[0],
    candidate: originalBaskets[1],
  })

  for (const activeDays of [originallyActive, [...originallyActive].reverse()]) {
    const remade = stores.map(({ store }) =>
      makeBasket(store, sharedProducts, editedPlan, activeDays),
    )
    assert.deepEqual(remade, originalBaskets)
    assert.deepEqual(
      compareFullBaskets({ baseline: remade[0], candidate: remade[1] }),
      originalComparison,
    )
    for (let i = 0; i < stores.length; i++) {
      assert.equal(shoppingListBasketKey(remade[i]), shoppingListBasketKey(originalBaskets[i]))
      assert.deepEqual(restoreShoppingListProgress(remade[i], saved[i].raw), saved[i].ids)
    }
  }

  const activated = stores.map(({ store }) =>
    makeBasket(store, sharedProducts, editedPlan, [...originallyActive, 'Do']),
  )
  assert.notDeepEqual(activated[0].lines, originalBaskets[0].lines)
  assert.notDeepEqual(activated[1].lines, originalBaskets[1].lines)
  for (let i = 0; i < stores.length; i++) {
    assert.notEqual(shoppingListBasketKey(activated[i]), shoppingListBasketKey(originalBaskets[i]))
    assert.deepEqual(restoreShoppingListProgress(activated[i], saved[i].raw), [])
  }
})

test('product M3: activating a different meal does not import prior retailer ticks', () => {
  const inactiveDays = ['Ma', 'Wo']
  const activeDays = ['Ma', 'Wo', 'Do']
  const original = makeBasket(m3BaselineStore, m3BaselineProducts, m2InitialPlan, inactiveDays)
  const ticks = original.lines.filter((line) => line.status === 'matched')
    .slice(0, 2).map((line) => line.id)
  const originalRaw = serializeShoppingListProgress(original, ticks)
  const switched = makeBasket(m3CandidateStore, sharedProducts, m2InitialPlan, activeDays)
  assert.deepEqual(restoreShoppingListProgress(switched, originalRaw), [])
  assert.notEqual(shoppingListBasketKey(switched), shoppingListBasketKey(original))
})
