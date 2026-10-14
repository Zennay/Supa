import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Full four-meal / eleven physical-demand product-flow acceptance, #1564.
// The M2 example is synthetic and is NOT a genuine PLUS / DekaMarkt M3 run.
function fullWeek() {
  const generated = buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
  assert.equal(generated.lines.length, 11)
  return generated
}

function port(initial = null, onSecondRead = () => {}) {
  const values = new Map()
  if (initial !== null) values.set(v2Key, initial)
  const writes = []
  let reads = 0
  return {
    values, writes,
    getItem(key) {
      assert.equal(key, v2Key, 'no surprise legacy-v1 reads')
      reads++
      if (reads === 2) onSecondRead()
      return values.get(key) ?? null
    },
    setItem(key, value) { writes.push([key, value]); values.set(key, value) },
  }
}

test('M2 full-week: read-side physical store switch cannot persist 11-line obsolete checkmarks', () => {
  const basket = fullWeek()
  const candidate = basket.lines.find((line) => line.status === 'matched')
  assert.ok(candidate)
  const disk = port(null, () => { basket.store = { ...basket.store, id: 'fictional-second-store' } })
  const controller = openShoppingProgressStorageV2(basket, disk)
  controller.toggle(candidate.id)
  const pinned = controller.snapshot().demandIdentity
  assert.equal(controller.persist(), false)
  assert.notEqual(shoppingListDemandIdentity(basket), pinned)
  assert.deepEqual(disk.writes, [])
  assert.deepEqual(controller.snapshot().completedLineIds, [candidate.id])
})

test('M2 full-week: price-only refresh during read saves and restores trusted eleven-line checks', () => {
  const basket = fullWeek()
  const lines = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(lines.length >= 2)
  const [first, second] = lines
  const disk = port(null, () => {
    first.pricePerPackCents += 1
    first.lineTotalCents += first.packs
    basket.totalCents += first.packs
  })
  const controller = openShoppingProgressStorageV2(basket, disk)
  const identity = controller.snapshot().demandIdentity
  controller.toggle(first.id)
  assert.equal(controller.persist(), true)
  controller.toggle(second.id)
  assert.equal(controller.persist(), true)
  assert.equal(shoppingListDemandIdentity(basket), identity)
  assert.equal(disk.writes.length, 2)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, disk).snapshot().completedLineIds,
    [first.id, second.id],
  )
})

test('M2 full-week: stale second-tab checklist requires explicit recovery, not overwrite', () => {
  const basket = fullWeek()
  const [first, second] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = port()
  const tabA = openShoppingProgressStorageV2(basket, disk)
  const tabB = openShoppingProgressStorageV2(basket, disk)
  tabA.toggle(first.id)
  assert.equal(tabA.persist(), true)
  const saved = disk.values.get(v2Key)
  tabB.toggle(second.id)
  assert.equal(tabB.persist(), false)
  assert.equal(disk.values.get(v2Key), saved)
  assert.deepEqual(tabB.reloadSaved()?.completedLineIds, [first.id])
  tabB.toggle(second.id)
  assert.equal(tabB.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, disk).snapshot().completedLineIds,
    [first.id, second.id],
  )
  assert.equal(disk.writes.length, 2)
})
