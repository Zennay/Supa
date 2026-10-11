import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function currentBasket() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: m2InitialPlan.map((entry) => entry.day), recipes: m2Recipes,
  })
}

function shared() {
  const values = new Map()
  const writes = []
  return {
    values, writes,
    port: {
      getItem(key) { return values.get(key) ?? null },
      setItem(key, value) { writes.push([key, value]); values.set(key, value) },
    },
  }
}

test('three interleaved tabs can recover and append checks sequentially without losing prior checks', () => {
  const basket = currentBasket()
  const [a, b, c] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(a && b && c)
  const disk = shared()
  const tabs = Array.from({ length: 3 }, () => openShoppingProgressStorageV2(basket, disk.port))

  tabs[0].toggle(a.id)
  assert.equal(tabs[0].persist(), true)
  tabs[1].toggle(b.id)
  assert.equal(tabs[1].persist(), false)
  assert.deepEqual(tabs[1].reloadSaved()?.completedLineIds, [a.id])
  tabs[1].toggle(b.id)
  assert.equal(tabs[1].persist(), true)

  tabs[2].toggle(c.id)
  assert.equal(tabs[2].persist(), false)
  assert.deepEqual(tabs[2].reloadSaved()?.completedLineIds, [a.id, b.id])
  tabs[2].toggle(c.id)
  assert.equal(tabs[2].persist(), true)
  assert.equal(tabs[0].persist(), false)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, disk.port).snapshot().completedLineIds,
    [a.id, b.id, c.id],
  )
  assert.equal(disk.writes.length, 3, 'failed attempts and reloads never perform writes')
})

test('recover after a price-only rebase keeps physical checks but uses the newer saved v2 revision', () => {
  const basket = currentBasket()
  const [a, b] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(a && b)
  const disk = shared()
  const newTab = openShoppingProgressStorageV2(basket, disk.port)
  const oldTab = openShoppingProgressStorageV2(basket, disk.port)
  newTab.toggle(a.id)
  assert.equal(newTab.persist(), true)

  const repriced = structuredClone(basket)
  const priced = repriced.lines.find((row) => row.status === 'matched')
  assert.ok(priced)
  priced.pricePerPackCents += 1
  priced.lineTotalCents += priced.packs
  assert.equal(shoppingListDemandIdentity(repriced), shoppingListDemandIdentity(basket))

  oldTab.rebase(repriced)
  oldTab.toggle(b.id)
  assert.equal(oldTab.persist(), false)
  const writes = disk.writes.length
  assert.deepEqual(oldTab.reloadSaved()?.completedLineIds, [a.id])
  assert.equal(disk.writes.length, writes)
  oldTab.toggle(b.id)
  assert.equal(oldTab.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(repriced, disk.port).snapshot().completedLineIds,
    [a.id, b.id],
  )
})

test('explicit reload of a foreign-demand v2 snapshot shows no imported checks and never rewrites disk', () => {
  const original = currentBasket()
  const first = original.lines.find((line) => line.status === 'matched')
  assert.ok(first)
  const disk = shared()
  const writer = openShoppingProgressStorageV2(original, disk.port)
  writer.toggle(first.id)
  assert.equal(writer.persist(), true)
  const saved = disk.values.get(shoppingListProgressV2StorageKey)

  const foreign = structuredClone(original)
  foreign.store.id = 'synthetic-foreign-store'
  const newList = openShoppingProgressStorageV2(foreign, disk.port)
  assert.deepEqual(newList.reloadSaved()?.completedLineIds, [])
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), saved)
  assert.equal(disk.writes.length, 1)
  assert.deepEqual(newList.snapshot().completedLineIds, [])
  assert.equal(newList.persist(), true, 'an explicitly accepted new physical task can replace old task')
  assert.deepEqual(
    openShoppingProgressStorageV2(original, disk.port).snapshot().completedLineIds,
    [],
  )
})
