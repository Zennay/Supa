import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'
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

// Synthetic product fixtures only. No real PLUS/DekaMarkt observed prices,
// permissions, real-world savings claim, or M3 field-run evidence.
function build(store, products, plan = m2InitialPlan, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store,
    products,
    plan,
    activeDays,
    recipes: m2Recipes,
  })
}

function* permutations(values, prefix = []) {
  if (!values.length) {
    yield prefix
    return
  }
  for (let index = 0; index < values.length; index += 1) {
    yield* permutations(
      [...values.slice(0, index), ...values.slice(index + 1)],
      [...prefix, values[index]],
    )
  }
}

const foreign = [...m3BaselineProducts, ...m3CandidateProducts].map((product) => ({
  ...product,
  storeId: 'third-store-not-selected',
  priceCents: 0,
}))
const combined = [...foreign, ...m3CandidateProducts, ...m3BaselineProducts]
const catalogs = [
  combined,
  [...combined].reverse(),
]

test('product M3: checked list survives simultaneous week reorder and unselected-catalog collisions', () => {
  const baseline = build(m3BaselineStore, m3BaselineProducts)
  const candidate = build(m3CandidateStore, m3CandidateProducts)
  const initialComparison = compareFullBaskets({ baseline, candidate })
  assert.equal(initialComparison.claimable, true)

  const checked = baseline.lines.filter((line) => line.status === 'matched')
    .slice(0, 3).map((line) => line.id)
  assert.equal(checked.length, 3)
  const persisted = JSON.parse(serializeShoppingListProgress(baseline, checked))
  const roundTripped = JSON.stringify(persisted)
  const days = m2InitialPlan.map((meal) => meal.day)
  const recipes = m2InitialPlan.map((meal) => meal.recipeId)

  let combinations = 0
  for (const assignments of permutations(recipes)) {
    const plan = days.map((day, i) => ({ day, recipeId: assignments[i] }))
    for (const catalog of catalogs) {
      const nextBaseline = build(m3BaselineStore, catalog, plan)
      const nextCandidate = build(m3CandidateStore, catalog, plan)
      assert.deepEqual(nextBaseline, baseline)
      assert.deepEqual(nextCandidate, candidate)
      assert.deepEqual(
        compareFullBaskets({ baseline: nextBaseline, candidate: nextCandidate }),
        initialComparison,
      )
      assert.equal(shoppingListBasketKey(nextBaseline), shoppingListBasketKey(baseline))
      assert.deepEqual(restoreShoppingListProgress(nextBaseline, roundTripped), checked)
      combinations += 1
    }
  }
  assert.equal(combinations, 48)
})

test('product M3: each retailer restores only its own checked lines under shared mixed catalogs', () => {
  const baseline = build(m3BaselineStore, m3BaselineProducts)
  const candidate = build(m3CandidateStore, m3CandidateProducts)
  const baselineChecked = baseline.lines.filter((line) => line.status === 'matched')
    .slice(0, 2).map((line) => line.id)
  const candidateChecked = candidate.lines.filter((line) => line.status === 'matched')
    .slice(-2).map((line) => line.id)
  assert.equal(baselineChecked.length, 2)
  assert.equal(candidateChecked.length, 2)
  const baselineSaved = serializeShoppingListProgress(baseline, baselineChecked)
  const candidateSaved = serializeShoppingListProgress(candidate, candidateChecked)
  assert.notEqual(shoppingListBasketKey(baseline), shoppingListBasketKey(candidate))

  for (const catalog of catalogs) {
    const currentBaseline = build(m3BaselineStore, catalog)
    const currentCandidate = build(m3CandidateStore, catalog)
    assert.deepEqual(restoreShoppingListProgress(currentBaseline, baselineSaved), baselineChecked)
    assert.deepEqual(restoreShoppingListProgress(currentCandidate, candidateSaved), candidateChecked)
    assert.deepEqual(restoreShoppingListProgress(currentBaseline, candidateSaved), [])
    assert.deepEqual(restoreShoppingListProgress(currentCandidate, baselineSaved), [])
  }
})
