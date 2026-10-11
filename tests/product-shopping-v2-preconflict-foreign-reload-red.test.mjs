import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// #1580/#1564: An *ordinary manual reload* must not become implicit consent
// to replace a different physical shopping round, even before a failed save.
// All stores, weeks and checklist records below are synthetic.
function week() {
  const basket = buildOneStoreBasket({
    store: m2Store, recipes: m2Recipes, products: m2Products,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
  assert.equal(basket.lines.length, 11)
  return basket
}
function disk(initial) {
  const values = new Map([[key, initial]])
  const writes = []
  return {
    values, writes,
    getItem(name) {
      assert.equal(name, key, 'no legacy v1 read on manual reload')
      return values.get(name) ?? null
    },
    setItem(name, value) {
      assert.equal(name, key)
      writes.push(value)
      values.set(name, value)
    },
  }
}

test('RED #1580: reload before any failed save must not pin foreign physical demand', () => {
  const local = week()
  const [first, second] = local.lines.filter(line => line.status === 'matched')
  const localBytes = serializeShoppingProgressV2(local, [first.id])
  assert.ok(localBytes)
  const port = disk(localBytes)
  const tab = openShoppingProgressStorageV2(local, port)
  assert.deepEqual(tab.snapshot().completedLineIds, [first.id])

  // Another client switches to a genuinely different synthetic store.
  const foreign = { ...local, store: { ...local.store, id: 'fictional-second-store' } }
  const foreignBytes = serializeShoppingProgressV2(foreign, [second.id])
  assert.ok(foreignBytes)
  port.values.set(key, foreignBytes)
  const originalTicks = tab.snapshot().completedLineIds
  assert.equal(tab.reloadSaved(), null,
    'manual recovery must reject foreign saved round even before first conflict')
  assert.deepEqual(tab.snapshot().completedLineIds, originalTicks,
    'rejected recovery must not silently clear the prior checklist')
  assert.equal(port.values.get(key), foreignBytes)
  tab.toggle(second.id)
  assert.equal(tab.persist(), false, 'cannot replace newer foreign round')
  assert.equal(port.values.get(key), foreignBytes, 'raw bytes preserved')
  assert.deepEqual(port.writes, [])
})

test('same-demand newer checklist still recovers without writing, then can be saved', () => {
  const local = week()
  const [first, second] = local.lines.filter(line => line.status === 'matched')
  const initial = serializeShoppingProgressV2(local, [first.id])
  const revised = serializeShoppingProgressV2(local, [second.id])
  assert.ok(initial && revised)
  const port = disk(initial)
  const tab = openShoppingProgressStorageV2(local, port)
  port.values.set(key, revised)
  assert.deepEqual(tab.reloadSaved()?.completedLineIds, [second.id])
  assert.deepEqual(port.writes, [])
  tab.toggle(first.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(port.values.get(key)).doneLineIds, [second.id, first.id])
  assert.equal(port.writes.length, 1)
})

test('freshly opened controller still permits deliberate new physical basket switch', () => {
  const local = week()
  const [first] = local.lines.filter(line => line.status === 'matched')
  const foreign = { ...local, store: { ...local.store, id: 'fictional-other-store' } }
  const foreignBytes = serializeShoppingProgressV2(foreign, [first.id])
  assert.ok(foreignBytes)
  const port = disk(foreignBytes)
  const fresh = openShoppingProgressStorageV2(local, port)
  fresh.toggle(first.id)
  assert.equal(fresh.persist(), true, 'fresh explicit toggle retains intended task-switch flow')
  assert.deepEqual(JSON.parse(port.values.get(key)).doneLineIds, [first.id])
  assert.equal(port.writes.length, 1)
})
