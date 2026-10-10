import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import {
  reconcileShoppingProgressV2,
  restoreShoppingProgressV2,
  serializeShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

const activeWeeks = [
  [],
  ['Ma'],
  ['Di'],
  ['Wo'],
  ['Ma', 'Di'],
  m2DefaultActiveDays,
]
const examplePrices = [1, 25, 99, 249, 499, 999, 1599]

function basket(activeDays, products) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    activeDays,
    recipes: m2Recipes,
    products,
  })
}

test('462 fixture reprice permutations cannot erase physically unchanged shopping progress', () => {
  let cases = 0
  let selectedPriceChanges = 0

  for (const activeDays of activeWeeks) {
    const baseline = basket(activeDays, m2Products)
    const baselineIdentity = shoppingListDemandIdentity(baseline)
    assert.ok(baselineIdentity)

    const checked = baseline.lines.slice(0, 2).map((line) => line.id)
    const saved = serializeShoppingProgressV2(baseline, checked)
    assert.ok(saved)

    for (const repricedProduct of m2Products) {
      for (const priceCents of examplePrices) {
        const products = m2Products.map((candidate) =>
          candidate.id === repricedProduct.id
            ? { ...candidate, priceCents }
            : candidate,
        )
        const after = basket(activeDays, products)
        const identity = shoppingListDemandIdentity(after)
        assert.equal(
          identity,
          baselineIdentity,
          `price-only change affected identity for ${activeDays.join(',')} / ${repricedProduct.id} / ${priceCents}`,
        )
        assert.deepEqual(restoreShoppingProgressV2(after, saved), checked)
        assert.deepEqual(reconcileShoppingProgressV2(baseline, after, checked), checked)

        const baselineLine = baseline.lines.find(
          (line) => line.status === 'matched' && line.productId === repricedProduct.id,
        )
        if (baselineLine && priceCents !== repricedProduct.priceCents) {
          const afterLine = after.lines.find((line) => line.id === baselineLine.id)
          assert.ok(afterLine)
          assert.equal(afterLine.status, 'matched')
          assert.equal(
            afterLine.lineTotalCents - baselineLine.lineTotalCents,
            baselineLine.packs * (priceCents - repricedProduct.priceCents),
          )
          selectedPriceChanges += 1
        }

        cases += 1
      }
    }
  }

  assert.equal(cases, activeWeeks.length * m2Products.length * examplePrices.length)
  assert.ok(selectedPriceChanges > 0, 'matrix must exercise selected product repricing')
})
