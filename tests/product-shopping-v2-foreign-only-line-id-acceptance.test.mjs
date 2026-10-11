import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent #1603 acceptance above the frozen #1745 chain. This matrix
// uses invented physical basket changes, not observed retailer/field prices.
const local = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
})
assert.equal(local.lines.length, 11)
const first = local.lines.find(line => line.status === 'matched')
assert.ok(first)
const foreignOnlyId = 'fixture-foreign-only-physical-line'
const foreign = {
  ...local,
  store: { ...local.store, id: 'fixture-second-shop' },
  lines: [
    ...local.lines.filter(line => line.id !== first.id),
    { ...first, id: foreignOnlyId },
  ],
}
assert.equal(foreign.lines.length, 11)
assert.ok(!foreign.lines.some(line => line.id === first.id))
assert.ok(!local.lines.some(line => line.id === foreignOnlyId))

function storage(initial) {
  const bytes = new Map([[key, initial]])
  const writes = []
  const reads = []
  return {
    bytes, reads, writes,
    getItem(name) {
      assert.equal(name, key, 'never inspect legacy v1')
      reads.push(name)
      return bytes.get(name) ?? null
    },
    setItem(name, value) {
      assert.equal(name, key)
      writes.push(value)
      bytes.set(name, value)
    },
  }
}

function raw(ids) {
  const serialized = serializeShoppingProgressV2(foreign, [])
  assert.ok(serialized)
  return JSON.stringify({ ...JSON.parse(serialized), doneLineIds: ids })
}

test('foreign-only genuine physical line completion permits deliberate new-basket switch', () => {
  const original = raw([foreignOnlyId])
  const disk = storage(original)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready')
  assert.deepEqual(tab.snapshot().completedLineIds, [], 'foreign ticks are not locally inherited')
  tab.toggle(first.id)
  assert.equal(tab.persist(), true, 'foreign-only IDs must be verified against foreign lines')
  assert.equal(disk.writes.length, 1)
  assert.deepEqual(JSON.parse(disk.bytes.get(key)).doneLineIds, [first.id])
  assert.notEqual(disk.bytes.get(key), original)
})

test('lookalike local completion absent from foreign physical lines remains read-only', () => {
  const original = raw([foreignOnlyId, first.id])
  const disk = storage(original)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready', 'foreign read compatibility precedes save preflight')
  tab.toggle(first.id)
  assert.equal(tab.persist(), false)
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  assert.equal(tab.reloadSaved(), null)
  assert.equal(disk.bytes.get(key), original)
  assert.deepEqual(disk.writes, [])
})

test('same-demand-only reload refuses a valid foreign-only completion without pinning it', () => {
  const original = raw([foreignOnlyId])
  const disk = storage(original)
  const tab = openShoppingProgressStorageV2(local, disk)
  tab.toggle(first.id)
  const before = tab.snapshot().completedLineIds
  assert.equal(tab.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(tab.snapshot().completedLineIds, before)
  assert.equal(disk.bytes.get(key), original)
  assert.deepEqual(disk.writes, [], 'read-only recovery cannot consume another shopping round')
  assert.equal(tab.persist(), true, 'explicit fresh switch is separate from guarded reload')
  assert.deepEqual(JSON.parse(disk.bytes.get(key)).doneLineIds, [first.id])
})
