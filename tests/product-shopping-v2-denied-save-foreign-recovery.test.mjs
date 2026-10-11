import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function physicalTasks() {
  const a = buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: m2InitialPlan.map((entry) => entry.day), recipes: m2Recipes,
  })
  const b = structuredClone(a)
  b.store.id = 'synthetic-other-demand'
  const first = a.lines.find((line) => line.status === 'matched')
  assert.ok(first)
  return { a, b, first: first.id }
}

function durablePort(values) {
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
}

test('an initially denied storage read plus failed save cannot silently replace foreign restored demand', () => {
  const { a, b, first } = physicalTasks()
  const values = new Map()
  let denyReads = true
  const stalePort = {
    getItem(key) {
      if (denyReads) throw Error('synthetic private-storage read denial')
      return values.get(key) ?? null
    },
    setItem(key, value) { values.set(key, value) },
  }
  const stale = openShoppingProgressStorageV2(a, stalePort)
  stale.toggle(first)
  assert.equal(stale.persist(), false, 'initial unreadable storage cannot persist')

  const owner = openShoppingProgressStorageV2(b, durablePort(values))
  owner.toggle(first)
  assert.equal(owner.persist(), true)
  const foreign = values.get(v2Key)
  denyReads = false

  assert.equal(stale.reloadSaved(), null, 'failed-save recovery must not treat newer B as empty A')
  assert.deepEqual(stale.snapshot().completedLineIds, [first])
  assert.equal(stale.persist(), false, 'cannot pin a foreign revision to authorize A overwrite')
  assert.equal(values.get(v2Key), foreign)
})

test('a quota-denied old write cannot later adopt a new foreign store saved in another tab', () => {
  const { a, b, first } = physicalTasks()
  const values = new Map()
  let denyOldWrite = true
  const oldPort = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) {
      if (denyOldWrite) throw Error('synthetic quota denial')
      values.set(key, value)
    },
  }
  const stale = openShoppingProgressStorageV2(a, oldPort)
  const owner = openShoppingProgressStorageV2(b, durablePort(values))
  stale.toggle(first)
  assert.equal(stale.persist(), false, 'write failed without discovering a storage revision')
  owner.toggle(first)
  assert.equal(owner.persist(), true)
  const foreign = values.get(v2Key)
  denyOldWrite = false

  assert.equal(stale.reloadSaved(), null)
  assert.equal(stale.persist(), false)
  assert.equal(values.get(v2Key), foreign)
  assert.deepEqual(openShoppingProgressStorageV2(b, durablePort(values)).snapshot().completedLineIds, [first])
})

test('a failed old write still permits explicit same-demand recovery and later save', () => {
  const { a, first } = physicalTasks()
  const values = new Map()
  let denyOldWrite = true
  const port = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) {
      if (denyOldWrite) throw Error('synthetic quota denial')
      values.set(key, value)
    },
  }
  const stale = openShoppingProgressStorageV2(a, port)
  const owner = openShoppingProgressStorageV2(a, durablePort(values))
  stale.toggle(first)
  assert.equal(stale.persist(), false)
  assert.equal(owner.persist(), true)
  denyOldWrite = false
  assert.deepEqual(stale.reloadSaved()?.completedLineIds, [])
  stale.toggle(first)
  assert.equal(stale.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(a, durablePort(values)).snapshot().completedLineIds, [first])
})
