import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent, synthetic #1603 acceptance. An equal line ID alone never means
// two physical shopping rounds have the same store, required amount, or pack.
const local = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
})
assert.equal(local.lines.length, 11)
const priced = local.lines.find(line => line.status === 'matched')
assert.ok(priced)
const second = local.lines.find(line => line.id !== priced.id)
assert.ok(second)

function storage(raw) {
  const records = new Map([[key, raw]])
  const writes = []
  return {
    records, writes,
    getItem(name) { assert.equal(name, key); return records.get(name) ?? null },
    setItem(name, value) { assert.equal(name, key); writes.push(value); records.set(name, value) },
  }
}

function savedForeign(foreign, checked = [priced.id]) {
  const raw = serializeShoppingProgressV2(foreign, checked)
  assert.ok(raw)
  assert.notEqual(shoppingListDemandIdentity(foreign), shoppingListDemandIdentity(local))
  assert.deepEqual(JSON.parse(raw).doneLineIds, checked)
  return raw
}

test('identical line IDs in a different store do not import old trolley checks', () => {
  const foreign = { ...local, store: { ...local.store, id: 'synthetic-different-store' } }
  const original = savedForeign(foreign)
  const disk = storage(original)
  const tab = openShoppingProgressStorageV2(local, disk)

  assert.equal(tab.storageFormatStatus(), 'ready')
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  assert.deepEqual(disk.writes, [])
  // A newly opened, explicit local shopping action may switch the task; the
  // foreign record must never be adopted merely because the line ID matches.
  tab.toggle(second.id)
  assert.deepEqual(tab.snapshot().completedLineIds, [second.id])
  assert.equal(tab.persist(), true)
  assert.equal(disk.writes.length, 1)
  assert.equal(JSON.parse(disk.records.get(key)).demandIdentity, shoppingListDemandIdentity(local))
  assert.deepEqual(JSON.parse(disk.records.get(key)).doneLineIds, [second.id])
})

test('same store and IDs but changed pack count reset the foreign round', () => {
  const changed = {
    ...local,
    lines: local.lines.map(line => line.id === priced.id
      ? { ...line, packs: line.packs + 1 }
      : line),
  }
  const original = savedForeign(changed)
  const disk = storage(original)
  const tab = openShoppingProgressStorageV2(local, disk)

  assert.deepEqual(tab.snapshot().completedLineIds, [])
  assert.equal(tab.storageFormatStatus(), 'ready')
  assert.deepEqual(disk.writes, [])
  // A display-only rebase cannot import the saved completion from an older
  // physical pack demand, despite price and presentation being changeable.
  tab.rebase({ ...local, totalCents: local.totalCents + 5 })
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  assert.equal(disk.records.get(key), original)
  tab.toggle(second.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(disk.records.get(key)).doneLineIds, [second.id])
})

test('same ID switched from matched to unresolved never becomes a same-demand reload', () => {
  const changed = {
    ...local,
    lines: local.lines.map(line => line.id === priced.id
      ? { id: line.id, status: 'unresolved', requirement: line.requirement }
      : line),
  }
  const original = savedForeign(changed)
  const disk = storage(original)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  tab.toggle(second.id)
  const before = tab.snapshot()
  assert.equal(tab.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(tab.snapshot(), before, 'denied read-only recovery preserves unsaved ticks')
  assert.equal(disk.records.get(key), original)
  assert.deepEqual(disk.writes, [])
})
