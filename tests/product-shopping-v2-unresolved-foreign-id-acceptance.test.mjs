import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Add-only #1603 acceptance on frozen #1755: genuine physical membership
// includes unresolved requirements, not just retailer-matched products.
// Every ID/store/quantity here comes from synthetic M2 fixtures.
const local = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
})
assert.equal(local.lines.length, 11)
const matched = local.lines.find(line => line.status === 'matched')
assert.ok(matched)
const foreignUnresolvedId = 'fixture-foreign-unresolved-line'
const foreign = {
  ...local,
  store: { ...local.store, id: 'fixture-foreign-store' },
  lines: [
    ...local.lines.filter(line => line.id !== matched.id),
    { id: foreignUnresolvedId, ingredientLabel: matched.ingredientLabel, status: 'unresolved', requirement: matched.requirement },
  ],
}
assert.equal(foreign.lines.length, 11)
assert.ok(!local.lines.some(line => line.id === foreignUnresolvedId))
const foreignCanonical = serializeShoppingProgressV2(foreign, [foreignUnresolvedId])
assert.ok(foreignCanonical)
assert.deepEqual(JSON.parse(foreignCanonical).doneLineIds, [foreignUnresolvedId])

function memory(raw) {
  const data = new Map([[key, raw]])
  const writes = []
  return {
    data, writes,
    getItem(name) { assert.equal(name, key); return data.get(name) ?? null },
    setItem(name, value) { assert.equal(name, key); writes.push(value); data.set(name, value) },
  }
}

test('foreign unresolved physical completion may be replaced only by an explicit new local save', () => {
  const disk = memory(foreignCanonical)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready')
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  assert.deepEqual(disk.writes, [], 'opening a different shopping task is read-only')
  tab.toggle(matched.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(disk.data.get(key)).doneLineIds, [matched.id])
  assert.equal(disk.writes.length, 1)
})

test('foreign unresolved completion absent from its own physical demand is protected across clear/rebase', () => {
  const poisoned = JSON.stringify({
    ...JSON.parse(foreignCanonical),
    doneLineIds: [foreignUnresolvedId, 'fixture-foreign-phantom-unresolved'],
  })
  const disk = memory(poisoned)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready', 'initial foreign preview remains compatible')
  tab.clear()
  assert.equal(tab.persist(), false, 'do not erase foreign phantom ID')
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  tab.rebase(local)
  assert.equal(tab.persist(), false)
  assert.equal(tab.reloadSaved(), null)
  assert.equal(disk.data.get(key), poisoned)
  assert.deepEqual(disk.writes, [])
})

test('same-demand unresolved completion reload is restorable and does not rewrite bytes', () => {
  const disk = memory(foreignCanonical)
  const tab = openShoppingProgressStorageV2(foreign, disk)
  assert.deepEqual(tab.snapshot().completedLineIds, [foreignUnresolvedId])
  tab.toggle(foreignUnresolvedId)
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  const loaded = tab.reloadSaved({ requireSameDemand: true })
  assert.ok(loaded)
  assert.deepEqual(loaded.completedLineIds, [foreignUnresolvedId])
  assert.deepEqual(disk.writes, [])
  assert.equal(disk.data.get(key), foreignCanonical)
})
