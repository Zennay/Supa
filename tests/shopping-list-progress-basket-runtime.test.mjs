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
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

function defaultBasket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

test('shopping progress rejects invalid basket containers at its runtime boundary', () => {
  const basket = defaultBasket()
  const raw = serializeShoppingListProgress(basket, [basket.lines[0].id])

  for (const invalidBasket of [
    null,
    undefined,
    {},
    { store: basket.store, lines: null },
    { store: null, lines: basket.lines },
  ]) {
    assert.doesNotThrow(() => {
      assert.deepEqual(restoreShoppingListProgress(invalidBasket, raw), [])
    })

    assert.throws(
      () => shoppingListBasketKey(invalidBasket),
      /Invalid shopping list basket runtime shape/,
    )
    assert.throws(
      () => serializeShoppingListProgress(invalidBasket, []),
      /Invalid shopping list basket runtime shape/,
    )
  }
})

test('shopping progress rejects invalid nested basket identity and numeric state', () => {
  const basket = defaultBasket()
  const matchedIndex = basket.lines.findIndex((line) => line.status === 'matched')
  assert.notEqual(matchedIndex, -1)

  const invalidBaskets = [
    {
      ...basket,
      store: { ...basket.store, id: ` ${basket.store.id}` },
    },
    {
      ...basket,
      lines: basket.lines.map((line, index) =>
        index === matchedIndex
          ? {
              ...line,
              requirement: {
                ...line.requirement,
                amount: Number.POSITIVE_INFINITY,
              },
            }
          : line,
      ),
    },
    {
      ...basket,
      lines: basket.lines.map((line, index) =>
        index === matchedIndex && line.status === 'matched'
          ? {
              ...line,
              pack: { ...line.pack, count: Number.NaN },
            }
          : line,
      ),
    },
    {
      ...basket,
      lines: [basket.lines[0], basket.lines[0], ...basket.lines.slice(1)],
    },
  ]

  for (const invalidBasket of invalidBaskets) {
    assert.deepEqual(restoreShoppingListProgress(invalidBasket, '{}'), [])
    assert.throws(
      () => shoppingListBasketKey(invalidBasket),
      /Invalid shopping list basket runtime shape/,
    )
    assert.throws(
      () => serializeShoppingListProgress(invalidBasket, []),
      /Invalid shopping list basket runtime shape/,
    )
  }
})

test('shopping progress preserves the existing valid basket key and round-trip contract', () => {
  const basket = defaultBasket()
  const expectedKey = JSON.stringify({
    storeId: basket.store.id,
    lines: basket.lines.map((line) =>
      line.status === 'matched'
        ? {
            id: line.id,
            status: line.status,
            amount: line.requirement.amount,
            unit: line.requirement.unit,
            productId: line.productId,
            packs: line.packs,
            packAmount: line.pack.amount,
            packUnit: line.pack.unit,
            packCount: line.pack.count,
            pricePerPackCents: line.pricePerPackCents,
            lineTotalCents: line.lineTotalCents,
          }
        : {
            id: line.id,
            status: line.status,
            amount: line.requirement.amount,
            unit: line.requirement.unit,
          },
    ),
  })

  assert.equal(shoppingListBasketKey(basket), expectedKey)

  const doneId = basket.lines[0].id
  const raw = serializeShoppingListProgress(basket, [doneId])
  assert.deepEqual(restoreShoppingListProgress(basket, raw), [doneId])
})
