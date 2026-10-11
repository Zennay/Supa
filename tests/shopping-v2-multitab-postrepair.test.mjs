import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basketFixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: ['Di'], recipes: m2Recipes,
  })
}

function portFixture() {
  const entries = new Map()
  let denyRead = false
  let denyWrite = false
  return {
    entries,
    control: {
      denyRead(value) { denyRead = value },
      denyWrite(value) { denyWrite = value },
    },
    storage: {
      getItem(key) {
        if (denyRead) throw new Error('synthetic read-denied')
        return entries.get(key) ?? null
      },
      setItem(key, value) {
        if (denyWrite) throw new Error('synthetic quota')
        entries.set(key, value)
      },
    },
  }
}

test('if storage reads become unavailable after opening, never blindly overwrite and allow safe retry', () => {
  const basket = basketFixture()
  const checked = basket.lines.find((line) => line.status === 'matched')
  assert.ok(checked)
  const { entries, control, storage } = portFixture()
  const tab = openShoppingProgressStorageV2(basket, storage)
  tab.toggle(checked.id)
  control.denyRead(true)
  assert.equal(tab.persist(), false, 'denied verification read must fail closed')
  assert.equal(entries.has(shoppingListProgressV2StorageKey), false)
  control.denyRead(false)
  assert.equal(tab.persist(), true, 'same desired write can be explicitly retried')
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, storage).snapshot().completedLineIds,
    [checked.id],
  )
})

test('a failed write followed by another tab saving must not silently overwrite that newer checklist', () => {
  const basket = basketFixture()
  const [one, two] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(one && two)
  const { entries, control, storage } = portFixture()
  const first = openShoppingProgressStorageV2(basket, storage)
  first.toggle(one.id)
  control.denyWrite(true)
  assert.equal(first.persist(), false)
  control.denyWrite(false)

  const newer = openShoppingProgressStorageV2(basket, storage)
  newer.toggle(two.id)
  assert.equal(newer.persist(), true)
  const newerSaved = entries.get(shoppingListProgressV2StorageKey)
  assert.ok(newerSaved)
  assert.equal(first.persist(), false, 'failed writes must not advance the last-known value')
  assert.equal(entries.get(shoppingListProgressV2StorageKey), newerSaved)
})

test('a freshly reopened tab can legitimately extend the currently saved checklist', () => {
  const basket = basketFixture()
  const [one, two] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(one && two)
  const { storage } = portFixture()
  const original = openShoppingProgressStorageV2(basket, storage)
  original.toggle(one.id)
  assert.equal(original.persist(), true)

  const fresh = openShoppingProgressStorageV2(basket, storage)
  assert.deepEqual(fresh.snapshot().completedLineIds, [one.id])
  fresh.toggle(two.id)
  assert.equal(fresh.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, storage).snapshot().completedLineIds,
    [one.id, two.id],
  )
})

test('an externally changed v2 value blocks a stale tab even when its basket identity is unchanged', () => {
  const basket = basketFixture()
  const line = basket.lines.find((row) => row.status === 'matched')
  assert.ok(line)
  const { entries, storage } = portFixture()
  const tab = openShoppingProgressStorageV2(basket, storage)
  const externallySaved = '{"schemaVersion":2,"demandIdentity":"other-session","doneLineIds":[]}'
  entries.set(shoppingListProgressV2StorageKey, externallySaved)
  tab.toggle(line.id)
  assert.equal(tab.persist(), false)
  assert.equal(entries.get(shoppingListProgressV2StorageKey), externallySaved)
})
