import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Product-core #1603/#1564: "reset checklist" must never silently
// downgrade a future v2 storage envelope or a corrupt opaque record.
// No actual user/store data; canonical fictional 4-meal/11-line M2 fixture.
function fullWeek() {
  const b = buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
  assert.equal(b.lines.length, 11)
  return b
}
function disk(initial) {
  const saved = new Map([[key, initial]])
  const writes = []
  return {
    saved, writes,
    getItem(k) {
      assert.equal(k, key, 'never consult v1 to override present v2 data')
      return saved.get(k) ?? null
    },
    setItem(k, raw) {
      assert.equal(k, key)
      writes.push(raw)
      saved.set(k, raw)
    },
  }
}

test('full-week reset cannot downgrade a future schema envelope on disk', () => {
  const week = fullWeek()
  const [first] = week.lines.filter((line) => line.status === 'matched')
  const canonical = JSON.parse(serializeShoppingProgressV2(week, [first.id]))
  const future = JSON.stringify({ ...canonical, schemaVersion: 3, nextClientMetadata: { key: 'fictional' } })
  const storage = disk(future)
  const session = openShoppingProgressStorageV2(week, storage)
  assert.equal(session.storageFormatStatus(), 'unknown-record')
  session.clear()
  assert.equal(session.persist(), false)
  assert.equal(session.reloadSaved(), null)
  assert.equal(storage.saved.get(key), future, 'future client bytes must survive clear')
  assert.deepEqual(storage.writes, [])
})

test('full-week reset cannot discard ambiguous duplicate-key v2 record', () => {
  const week = fullWeek()
  const canonical = JSON.parse(serializeShoppingProgressV2(week, []))
  // A duplicate root key cannot be resolved unambiguously by older clients.
  const ambiguous = '{"schemaVersion":2,"schemaVersion":3,"demandIdentity":' +
    JSON.stringify(canonical.demandIdentity) + ',"doneLineIds":[]}'
  const storage = disk(ambiguous)
  const session = openShoppingProgressStorageV2(week, storage)
  assert.equal(session.storageFormatStatus(), 'unknown-record')
  session.clear()
  assert.equal(session.persist(), false)
  assert.equal(storage.saved.get(key), ambiguous)
  assert.deepEqual(storage.writes, [])
})

test('full-week user can clear after deliberate recovery of compatible same-demand format', () => {
  const week = fullWeek()
  const [first] = week.lines.filter((line) => line.status === 'matched')
  const supported = serializeShoppingProgressV2(week, [first.id])
  assert.ok(supported)
  const future = JSON.stringify({
    ...JSON.parse(supported), nextSchemaVersion: 3,
  })
  const storage = disk(future)
  const session = openShoppingProgressStorageV2(week, storage)
  session.clear()
  assert.equal(session.persist(), false)
  assert.equal(session.reloadSaved(), null)
  assert.equal(storage.saved.get(key), future)
  // An explicit user recovery after a newer app wrote a compatible record.
  storage.saved.set(key, supported)
  assert.deepEqual(session.reloadSaved({ requireSameDemand: true })?.completedLineIds, [first.id])
  assert.equal(session.storageFormatStatus(), 'ready')
  session.clear()
  assert.equal(session.persist(), true)
  assert.deepEqual(JSON.parse(storage.saved.get(key)).doneLineIds, [])
  assert.equal(storage.writes.length, 1)
})
