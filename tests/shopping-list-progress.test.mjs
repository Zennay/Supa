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

test('shopping progress round-trips only valid unique line ids for the same basket', () => {
  const basket = defaultBasket()
  const firstId = basket.lines[0].id
  const raw = serializeShoppingListProgress(basket, [
    firstId,
    firstId,
    'not-a-current-line',
  ])

  assert.deepEqual(restoreShoppingListProgress(basket, raw), [firstId])
})

test('shopping progress fails closed when the basket demand changes', () => {
  const basket = defaultBasket()
  const raw = serializeShoppingListProgress(basket, [basket.lines[0].id])

  const changedBasket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Ma', 'Di', 'Wo'],
    products: m2Products,
  })

  assert.notEqual(
    shoppingListBasketKey(changedBasket),
    shoppingListBasketKey(basket),
  )
  assert.deepEqual(restoreShoppingListProgress(changedBasket, raw), [])
})

test('shopping progress resets when matched price or pack details change', () => {
  const basket = defaultBasket()
  const basmatiLine = basket.lines.find((line) => line.id === 'basmati-rice')
  assert.ok(basmatiLine)
  const raw = serializeShoppingListProgress(basket, [basmatiLine.id])

  for (const changedProducts of [
    m2Products.map((product) =>
      product.id === 'basmati-1kg'
        ? { ...product, priceCents: product.priceCents + 1 }
        : product,
    ),
    m2Products.map((product) =>
      product.id === 'basmati-1kg'
        ? { ...product, packAmount: 1000, packUnit: 'g' }
        : product,
    ),
  ]) {
    const changedBasket = buildOneStoreBasket({
      store: m2Store,
      plan: m2InitialPlan,
      recipes: m2Recipes,
      activeDays: m2DefaultActiveDays,
      products: changedProducts,
    })

    assert.notEqual(
      shoppingListBasketKey(changedBasket),
      shoppingListBasketKey(basket),
    )
    assert.deepEqual(restoreShoppingListProgress(changedBasket, raw), [])
  }
})

test('shopping progress rejects malformed or mismatched persisted state', () => {
  const basket = defaultBasket()

  assert.deepEqual(restoreShoppingListProgress(basket, '{bad-json'), [])
  assert.deepEqual(
    restoreShoppingListProgress(
      basket,
      JSON.stringify({
        schemaVersion: 2,
        basketKey: shoppingListBasketKey(basket),
        doneLineIds: [basket.lines[0].id],
      }),
    ),
    [],
  )
  assert.deepEqual(
    restoreShoppingListProgress(
      basket,
      JSON.stringify({
        schemaVersion: 1,
        basketKey: 'stale-basket',
        doneLineIds: [basket.lines[0].id],
      }),
    ),
    [],
  )
})


test('shopping progress resets when the store identity changes', () => {
  const basket = defaultBasket()
  const raw = serializeShoppingListProgress(basket, [basket.lines[0].id])
  const changedStoreBasket = {
    ...basket,
    store: { ...basket.store, id: 'different-store' },
  }

  assert.notEqual(
    shoppingListBasketKey(changedStoreBasket),
    shoppingListBasketKey(basket),
  )
  assert.deepEqual(restoreShoppingListProgress(changedStoreBasket, raw), [])
})

test('shopping progress resets when a line resolution state changes', () => {
  const basket = defaultBasket()
  const unresolved = basket.lines.find((line) => line.status === 'unresolved')
  assert.ok(unresolved)
  const raw = serializeShoppingListProgress(basket, [unresolved.id])

  const resolvedBasket = {
    ...basket,
    lines: basket.lines.map((line) =>
      line.id === unresolved.id
        ? {
            id: line.id,
            requirement: line.requirement,
            status: 'matched',
            productId: 'manual-resolution',
            productName: 'Handmatig gekozen product',
            packs: 1,
            pack: { amount: 1, unit: line.requirement.unit, count: 1 },
            pricePerPackCents: 100,
            lineTotalCents: 100,
            matchScore: 1,
            reasons: ['manual-test-resolution'],
          }
        : line,
    ),
  }

  assert.notEqual(shoppingListBasketKey(resolvedBasket), shoppingListBasketKey(basket))
  assert.deepEqual(restoreShoppingListProgress(resolvedBasket, raw), [])
})
