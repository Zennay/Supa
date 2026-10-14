import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Additive, synthetic #1603 acceptance on frozen #1764.
// Identical ingredient/line IDs are insufficient to import checked items when
// the physical quantity, matched product, or actual package changes.
const local = buildOneStoreBasket({
  store: m2Store,
  products: m2Products,
  recipes: m2Recipes,
  plan: m2InitialPlan,
  activeDays: m2DefaultActiveDays,
})
assert.equal(local.lines.length, 11)
const matched = local.lines.find(line => line.status === 'matched')
assert.ok(matched)
const other = local.lines.find(line => line.id !== matched.id)
assert.ok(other)

function replaceMatched(transform) {
  return {
    ...local,
    lines: local.lines.map(line => line.id === matched.id ? transform(line) : line),
  }
}

function storage(raw) {
  const records = new Map([[key, raw]])
  const writes = []
  return {
    records, writes,
    getItem(name) { assert.equal(name, key); return records.get(name) ?? null },
    setItem(name, value) { assert.equal(name, key); writes.push(value); records.set(name, value) },
  }
}

const physicalChanges = [
  ['required quantity', line => ({
    ...line,
    requirement: { ...line.requirement, amount: line.requirement.amount + 1 },
  })],
  ['required unit', line => ({
    ...line,
    requirement: { ...line.requirement, unit: line.requirement.unit === 'g' ? 'kg' : 'g' },
  })],
  ['matched product', line => ({ ...line, productId: 'synthetic-alternate-product' })],
  ['pack amount', line => ({ ...line, pack: { ...line.pack, amount: line.pack.amount + 1 } })],
  ['pack count', line => ({ ...line, pack: { ...line.pack, count: line.pack.count + 1 } })],
  ['pack unit', line => ({ ...line, pack: { ...line.pack, unit: line.pack.unit === 'g' ? 'kg' : 'g' } })],
]

for (const [label, transform] of physicalChanges) {
  test(`foreign checked IDs stay out of a newly opened task when ${label} differs`, () => {
    const foreign = replaceMatched(transform)
    const saved = serializeShoppingProgressV2(foreign, [matched.id])
    assert.ok(saved, 'synthetic foreign record must be a supported v2 document')
    assert.notEqual(shoppingListDemandIdentity(foreign), shoppingListDemandIdentity(local))
    const disk = storage(saved)
    const tab = openShoppingProgressStorageV2(local, disk)

    assert.equal(tab.storageFormatStatus(), 'ready')
    assert.deepEqual(tab.snapshot().completedLineIds, [])
    assert.deepEqual(disk.writes, [])
    assert.equal(disk.records.get(key), saved)

    // User-initiated switch must persist only this basket's fresh ticks;
    // the prior basket's identical line ID is never implicitly completed.
    tab.toggle(other.id)
    assert.deepEqual(tab.snapshot().completedLineIds, [other.id])
    assert.equal(tab.persist(), true)
    assert.equal(disk.writes.length, 1)
    assert.deepEqual(JSON.parse(disk.records.get(key)).doneLineIds, [other.id])
    assert.equal(JSON.parse(disk.records.get(key)).demandIdentity, shoppingListDemandIdentity(local))
  })

  test(`same-demand-only recovery refuses foreign ${label} without clearing local ticks`, () => {
    const foreign = replaceMatched(transform)
    const raw = serializeShoppingProgressV2(foreign, [matched.id])
    assert.ok(raw)
    const disk = storage(raw)
    const tab = openShoppingProgressStorageV2(local, disk)
    tab.toggle(other.id)
    const before = tab.snapshot()

    assert.equal(tab.reloadSaved({ requireSameDemand: true }), null)
    assert.deepEqual(tab.snapshot(), before)
    assert.equal(disk.records.get(key), raw)
    assert.deepEqual(disk.writes, [])
  })
}

test('price-only rebase retains checkmarks and saves without touching physical identity', () => {
  const disk = storage(null)
  const tab = openShoppingProgressStorageV2(local, disk)
  tab.toggle(matched.id)
  const originalIdentity = tab.snapshot().demandIdentity
  const repriced = {
    ...local,
    totalCents: local.totalCents + 100,
    lines: local.lines.map(line => ({
      ...line,
      ...(line.status === 'matched' ? { lineTotalCents: (line.lineTotalCents ?? 0) + 100 } : {}),
    })),
  }
  assert.equal(shoppingListDemandIdentity(repriced), originalIdentity)
  tab.rebase(repriced)
  assert.deepEqual(tab.snapshot().completedLineIds, [matched.id])
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(disk.records.get(key)).doneLineIds, [matched.id])
})
