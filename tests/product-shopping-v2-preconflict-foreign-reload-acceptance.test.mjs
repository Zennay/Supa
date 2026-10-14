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

// Independent postrepair acceptance for #1580, distinct from the focused
// pre-conflict RED in #1733. All 11 demands and both stores are fictional.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
})
assert.equal(basket.lines.length, 11)
const [first, second] = basket.lines.filter(line => line.status === 'matched')
assert.ok(first && second)
const foreign = {
  ...basket,
  store: { ...basket.store, id: 'fixture-other-physical-store' },
}
const foreignSaved = serializeShoppingProgressV2(foreign, [second.id])
const localA = serializeShoppingProgressV2(basket, [first.id])
const localB = serializeShoppingProgressV2(basket, [second.id])
assert.ok(foreignSaved && localA && localB)

function port(raw = null) {
  const data = new Map()
  if (raw !== null) data.set(key, raw)
  const writes = []
  const reads = []
  return {
    data, writes, reads,
    getItem(name) {
      reads.push(name)
      assert.equal(name, key, 'manual recovery may never access legacy key')
      return data.get(name) ?? null
    },
    setItem(name, raw) {
      assert.equal(name, key)
      writes.push(raw)
      data.set(name, raw)
    },
  }
}

test('independent #1580: initially empty key then foreign revision may never be adopted by ordinary reload', () => {
  const disk = port()
  const tab = openShoppingProgressStorageV2(basket, disk)
  tab.toggle(first.id)
  const before = tab.snapshot().completedLineIds
  disk.data.set(key, foreignSaved)

  assert.equal(tab.reloadSaved(), null)
  assert.deepEqual(tab.snapshot().completedLineIds, before)
  tab.clear()
  assert.equal(tab.persist(), false, 'clear must not overwrite foreign basket')
  assert.deepEqual(disk.writes, [])
  assert.equal(disk.data.get(key), foreignSaved, 'byte-exact foreign record stays untouched')
  assert.ok(disk.reads.every(name => name === key))
})

test('independent #1580: repeated wrong-round reloads after no-op physical rebase cannot steal the saved revision', () => {
  const disk = port(localA)
  const tab = openShoppingProgressStorageV2(basket, disk)
  const clonedPriceOnly = {
    ...basket,
    lines: basket.lines.map(line => ({ ...line })),
  }
  tab.rebase(clonedPriceOnly)
  assert.deepEqual(tab.snapshot().completedLineIds, [first.id])
  disk.data.set(key, foreignSaved)

  assert.equal(tab.reloadSaved(), null)
  assert.equal(tab.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(tab.snapshot().completedLineIds, [first.id])
  tab.toggle(second.id)
  assert.equal(tab.persist(), false)
  assert.equal(disk.data.get(key), foreignSaved)
  assert.deepEqual(disk.writes, [])
})

test('independent #1580: rejected foreign revision may recover after another client restores current demand', () => {
  const disk = port(localA)
  const tab = openShoppingProgressStorageV2(basket, disk)
  disk.data.set(key, foreignSaved)
  assert.equal(tab.reloadSaved(), null)
  assert.equal(tab.persist(), false)

  // A separate client selects the exact current physical task and writes a
  // fresh, known-good same-demand value; explicit reload may now opt in.
  disk.data.set(key, localB)
  assert.deepEqual(tab.reloadSaved()?.completedLineIds, [second.id])
  assert.deepEqual(disk.writes, [])
  tab.toggle(first.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(disk.data.get(key)).doneLineIds, [second.id, first.id])
  assert.equal(disk.writes.length, 1)
})
