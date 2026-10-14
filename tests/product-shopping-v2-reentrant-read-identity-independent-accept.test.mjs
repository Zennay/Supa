import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'

// Independent add-only postrepair acceptance for issue #1564.
// Only controlled local baskets, no real user/retailer prices, browser atomicity,
// hidden v1 migrations or live VPS evidence.
function basket() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: ['Di'],
  })
}

function sideEffectDisk(effect) {
  const values = new Map()
  const writes = []
  let reads = 0
  return {
    values, writes,
    getItem(key) {
      assert.equal(key, v2Key)
      reads++
      if (reads === 2) effect()
      return values.get(key) ?? null
    },
    setItem(key, value) {
      writes.push([key, value])
      values.set(key, value)
    },
  }
}

test('Product #1564 independent: post-read ingredient amount drift is rejected without writing', () => {
  const current = basket()
  const row = current.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  const disk = sideEffectDisk(() => { row.requirement.amount += 1 })
  const controller = openShoppingProgressStorageV2(current, disk)
  controller.toggle(row.id)
  const pinned = controller.snapshot().demandIdentity
  assert.equal(controller.persist(), false)
  assert.notEqual(shoppingListDemandIdentity(current), pinned)
  assert.deepEqual(disk.writes, [])
  assert.deepEqual(controller.snapshot().completedLineIds, [row.id])
})

test('Product #1564 independent: post-read product identity drift is rejected without writing', () => {
  const current = basket()
  const row = current.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  const disk = sideEffectDisk(() => { row.productId += '-replacement' })
  const controller = openShoppingProgressStorageV2(current, disk)
  controller.toggle(row.id)
  assert.equal(controller.persist(), false)
  assert.deepEqual(disk.writes, [])
  assert.equal(disk.values.has(v2Key), false)
})

test('Product #1564 independent: after a denied stale save, repairing basket in-place permits explicit retry', () => {
  const current = basket()
  const row = current.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  const oldCount = row.pack.count
  const disk = sideEffectDisk(() => { row.pack.count++ })
  const controller = openShoppingProgressStorageV2(current, disk)
  controller.toggle(row.id)
  assert.equal(controller.persist(), false)
  assert.deepEqual(disk.writes, [])
  row.pack.count = oldCount // recover original task only, same pinned revision
  assert.equal(controller.persist(), true)
  assert.equal(disk.writes.length, 1)
  assert.deepEqual(openShoppingProgressStorageV2(current, disk).snapshot().completedLineIds, [row.id])
})

test('Product #1564 independent: money-only drift during read permits consecutive saves', () => {
  const current = basket()
  const matched = current.lines.filter((line) => line.status === 'matched')
  assert.ok(matched.length >= 2)
  const [first, second] = matched
  const disk = sideEffectDisk(() => {
    first.pricePerPackCents += 1
    first.lineTotalCents += first.packs
    current.totalCents += first.packs
  })
  const controller = openShoppingProgressStorageV2(current, disk)
  const identity = controller.snapshot().demandIdentity
  controller.toggle(first.id)
  assert.equal(controller.persist(), true)
  assert.equal(controller.snapshot().demandIdentity, identity)
  controller.toggle(second.id)
  assert.equal(controller.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(current, disk).snapshot().completedLineIds, [first.id, second.id])
  assert.equal(disk.writes.length, 2)
})
