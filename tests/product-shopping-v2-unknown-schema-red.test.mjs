import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

function fixture() {
  const basket = buildOneStoreBasket({
    store: m2Store,
    products: m2Products,
    plan: m2InitialPlan,
    activeDays: ['Di'],
    recipes: m2Recipes,
  })
  const picked = basket.lines.find((line) => line.status === 'matched')
  assert.ok(picked)
  return { basket, picked: picked.id }
}

function disk(initial) {
  const data = new Map()
  if (initial !== null) data.set(v2Key, initial)
  let writes = 0
  return {
    data,
    get writes() { return writes },
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes++; data.set(key, value) },
  }
}

for (const [label, raw] of [
  ['future v3 value', JSON.stringify({ schemaVersion: 3, doneLineIds: ['future-task'], opaqueV3: true })],
  ['corrupt JSON', '{"schemaVersion":'],
  ['unsupported v2 doneLineIds shape', JSON.stringify({ schemaVersion: 2, demandIdentity: 'synthetic-task', doneLineIds: 'not-an-array' })],
  ['unexpected JSON scalar', JSON.stringify(44)],
]) {
  test('product expected RED: unknown persisted shopping schema must not be downgraded: ' + label, () => {
    const { basket, picked } = fixture()
    const storage = disk(raw)
    const tab = openShoppingProgressStorageV2(basket, storage)
    assert.deepEqual(tab.snapshot().completedLineIds, [])
    assert.deepEqual(tab.toggle(picked).completedLineIds, [picked], 'in-memory shopping remains usable')
    assert.equal(tab.persist(), false, 'an old v2 tab must not overwrite unknown durable data')
    assert.equal(storage.writes, 0, 'unknown stored bytes are never rewritten')
    assert.equal(storage.data.get(v2Key), raw)
  })
}

test('product controls: empty key and supported v2 same-demand records remain writable', () => {
  const { basket, picked } = fixture()
  const fresh = disk(null)
  const start = openShoppingProgressStorageV2(basket, fresh)
  start.toggle(picked)
  assert.equal(start.persist(), true)
  assert.equal(fresh.writes, 1)
  assert.deepEqual(openShoppingProgressStorageV2(basket, fresh).snapshot().completedLineIds, [picked])

  const known = disk(serializeShoppingProgressV2(basket, [picked]))
  const recovered = openShoppingProgressStorageV2(basket, known)
  assert.deepEqual(recovered.snapshot().completedLineIds, [picked])
  recovered.toggle(picked)
  assert.equal(recovered.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(basket, known).snapshot().completedLineIds, [])
})

test('product control: a fresh controller may intentionally start another valid v2 physical task', () => {
  const { basket, picked } = fixture()
  const other = structuredClone(basket)
  other.store.id = 'synthetic-previous-physical-task'
  const raw = serializeShoppingProgressV2(other, [picked])
  assert.ok(raw)
  const storage = disk(raw)
  const newTask = openShoppingProgressStorageV2(basket, storage)
  assert.deepEqual(newTask.snapshot().completedLineIds, [])
  newTask.toggle(picked)
  assert.equal(newTask.persist(), true)
  assert.notEqual(storage.data.get(v2Key), raw)
  assert.deepEqual(openShoppingProgressStorageV2(basket, storage).snapshot().completedLineIds, [picked])
})
