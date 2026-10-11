import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function baskets() {
  const original = buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: m2InitialPlan.map((entry) => entry.day), recipes: m2Recipes,
  })
  const next = structuredClone(original)
  next.store.id = 'synthetic-next-shopping-task'
  const [a, b] = original.lines.filter((line) => line.status === 'matched')
  assert.ok(a && b)
  return { original, next, a: a.id, b: b.id }
}

function shared() {
  const records = new Map()
  let writes = 0
  return {
    records,
    get writes() { return writes },
    port: {
      getItem(key) { return records.get(key) ?? null },
      setItem(key, value) { writes++; records.set(key, value) },
    },
  }
}

test('initial read failure can recover an empty same-demand checklist after storage becomes usable', () => {
  const { original, a } = baskets()
  const disk = shared()
  let deny = true
  const restricted = {
    getItem(key) {
      if (deny) throw Error('synthetic initial read denial')
      return disk.port.getItem(key)
    },
    setItem(key, value) { disk.port.setItem(key, value) },
  }
  const tab = openShoppingProgressStorageV2(original, restricted)
  tab.toggle(a)
  assert.equal(tab.persist(), false)
  deny = false
  assert.deepEqual(tab.reloadSaved()?.completedLineIds, [], 'no foreign saved task, so empty recovery is valid')
  tab.toggle(a)
  assert.equal(tab.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(original, disk.port).snapshot().completedLineIds, [a])
  assert.equal(disk.writes, 1)
})

test('after a denied write, deliberately rebasing to newer foreign physical task safely restores its checks', () => {
  const { original, next, a, b } = baskets()
  const disk = shared()
  let denyWrite = true
  const restricted = {
    getItem(key) { return disk.port.getItem(key) },
    setItem(key, value) {
      if (denyWrite) throw Error('synthetic quota denied')
      disk.port.setItem(key, value)
    },
  }
  const oldTab = openShoppingProgressStorageV2(original, restricted)
  const newTab = openShoppingProgressStorageV2(next, disk.port)
  oldTab.toggle(b)
  assert.equal(oldTab.persist(), false)
  newTab.toggle(a)
  assert.equal(newTab.persist(), true)
  const stored = disk.records.get(v2Key)
  denyWrite = false

  assert.equal(oldTab.reloadSaved(), null, 'old physical task cannot be silently revived')
  oldTab.rebase(next)
  assert.deepEqual(oldTab.reloadSaved()?.completedLineIds, [a])
  assert.equal(disk.records.get(v2Key), stored, 'recovery reads but never writes')
  oldTab.toggle(b)
  assert.equal(oldTab.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(next, disk.port).snapshot().completedLineIds, [a, b])
})

test('denied recovery reads never drop local unsaved ticks or loosen the failed-save guard', () => {
  const { original, next, a } = baskets()
  const disk = shared()
  let denyWrite = true
  let denyRead = false
  const port = {
    getItem(key) {
      if (denyRead) throw Error('synthetic transient read failure')
      return disk.port.getItem(key)
    },
    setItem(key, value) {
      if (denyWrite) throw Error('synthetic temporary write denial')
      disk.port.setItem(key, value)
    },
  }
  const oldTab = openShoppingProgressStorageV2(original, port)
  oldTab.toggle(a)
  assert.equal(oldTab.persist(), false)
  const newTab = openShoppingProgressStorageV2(next, disk.port)
  newTab.toggle(a)
  assert.equal(newTab.persist(), true)
  const foreign = disk.records.get(v2Key)
  denyWrite = false
  denyRead = true

  const local = oldTab.snapshot()
  assert.equal(oldTab.reloadSaved(), null)
  assert.deepEqual(oldTab.snapshot(), local)
  denyRead = false
  assert.equal(oldTab.reloadSaved(), null, 'recovered access must not accept newer foreign task')
  assert.equal(oldTab.persist(), false)
  assert.equal(disk.records.get(v2Key), foreign)
  assert.equal(disk.writes, 1)
})
