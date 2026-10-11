import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function makeBasket() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: ['Di'], recipes: m2Recipes,
  })
}

function priceRefresh(basket) {
  const repriced = structuredClone(basket)
  const line = repriced.lines.find((row) => row.status === 'matched')
  assert.ok(line)
  assert.ok(Number.isSafeInteger(line.pricePerPackCents))
  assert.ok(Number.isSafeInteger(line.lineTotalCents))
  line.pricePerPackCents += 1
  line.lineTotalCents += line.packs
  assert.equal(shoppingListDemandIdentity(repriced), shoppingListDemandIdentity(basket))
  return repriced
}

function memoryPort() {
  const store = new Map()
  return {
    store,
    port: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value) },
    },
  }
}

test('one tab preserves completed groceries across a price-only rebase and persists additional checks', () => {
  const basket = makeBasket()
  const [first, second] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const { port } = memoryPort()
  const controller = openShoppingProgressStorageV2(basket, port)
  controller.toggle(first.id)
  assert.equal(controller.persist(), true)
  const refreshed = priceRefresh(basket)
  assert.deepEqual(controller.rebase(refreshed).completedLineIds, [first.id])
  controller.toggle(second.id)
  assert.equal(controller.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(refreshed, port).snapshot().completedLineIds,
    [first.id, second.id],
  )
})

test('price-only rebase does not let an old tab overwrite the newer durable list', () => {
  const basket = makeBasket()
  const [first, second] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const { port, store } = memoryPort()
  const currentTab = openShoppingProgressStorageV2(basket, port)
  const olderTab = openShoppingProgressStorageV2(basket, port)
  currentTab.toggle(first.id)
  assert.equal(currentTab.persist(), true)
  const durable = store.get(shoppingListProgressV2StorageKey)

  olderTab.rebase(priceRefresh(basket))
  olderTab.toggle(second.id)
  assert.equal(olderTab.persist(), false, 'a different price does not license overwriting another tab')
  assert.equal(store.get(shoppingListProgressV2StorageKey), durable)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, port).snapshot().completedLineIds,
    [first.id],
  )
})
