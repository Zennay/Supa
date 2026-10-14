import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as storageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent synthetic product-core acceptance above frozen #1765 for #1603.
// These are locally generated M2 fixture baskets, NEVER real retailer observations.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
})
assert.equal(basket.lines.length, 11)
const matched = basket.lines.find(line => line.status === 'matched')
assert.ok(matched)
const other = basket.lines.find(line => line.id !== matched.id)
assert.ok(other)

function disk(raw) {
  const items = new Map()
  if (raw !== null) items.set(storageKey, raw)
  const writes = []
  return {
    items, writes,
    getItem(key) {
      assert.equal(key, storageKey)
      return items.get(key) ?? null
    },
    setItem(key, value) {
      assert.equal(key, storageKey)
      writes.push(value)
      items.set(key, value)
    },
  }
}

const physicallyDifferent = [
  ['number of purchased packs', {
    ...basket,
    lines: basket.lines.map(line => line.id === matched.id
      ? { ...line, packs: line.packs + 1 }
      : line),
  }],
  ['an extra physical shopping line', {
    ...basket,
    lines: [...basket.lines, { ...other, id: 'synthetic-new-shopping-line' }],
  }],
  ['a removed physical shopping line', {
    ...basket,
    lines: basket.lines.filter(line => line.id !== other.id),
  }],
]

for (const [label, foreign] of physicallyDifferent) {
  test(`changed ${label} does not import equal checked IDs from a foreign task`, () => {
    const raw = serializeShoppingProgressV2(foreign, [matched.id])
    assert.ok(raw)
    assert.notEqual(shoppingListDemandIdentity(foreign), shoppingListDemandIdentity(basket))
    const store = disk(raw)
    const tab = openShoppingProgressStorageV2(basket, store)
    assert.equal(tab.storageFormatStatus(), 'ready')
    assert.deepEqual(tab.snapshot().completedLineIds, [])
    assert.deepEqual(store.writes, [])

    // Explicit task switch can save *new local* ticks, not foreign checked IDs.
    tab.toggle(other.id)
    assert.deepEqual(tab.snapshot().completedLineIds, [other.id])
    assert.equal(tab.persist(), true)
    assert.deepEqual(JSON.parse(store.items.get(storageKey)).doneLineIds, [other.id])
    assert.equal(JSON.parse(store.items.get(storageKey)).demandIdentity, shoppingListDemandIdentity(basket))
  })

  test(`same-demand-only recovery refuses changed ${label} and retains unsaved ticks`, () => {
    const raw = serializeShoppingProgressV2(foreign, [matched.id])
    assert.ok(raw)
    const store = disk(raw)
    const tab = openShoppingProgressStorageV2(basket, store)
    tab.toggle(other.id)
    const before = tab.snapshot()
    assert.equal(tab.reloadSaved({ requireSameDemand: true }), null)
    assert.deepEqual(tab.snapshot(), before)
    assert.equal(store.items.get(storageKey), raw)
    assert.deepEqual(store.writes, [])
  })

  test(`physical rebase for ${label} clears checked lines permanently without implicit storage writes`, () => {
    const store = disk(null)
    const tab = openShoppingProgressStorageV2(basket, store)
    tab.toggle(matched.id)
    assert.deepEqual(tab.snapshot().completedLineIds, [matched.id])
    tab.rebase(foreign)
    assert.deepEqual(tab.snapshot().completedLineIds, [])
    tab.rebase(basket)
    assert.deepEqual(tab.snapshot().completedLineIds, [])
    assert.deepEqual(store.writes, [])
  })
}

test('presentation-only row reordering restores and preserves exactly the same physical ticks', () => {
  const raw = serializeShoppingProgressV2(basket, [matched.id, other.id])
  assert.ok(raw)
  const reordered = {
    ...basket,
    lines: [...basket.lines].reverse(),
  }
  assert.equal(shoppingListDemandIdentity(reordered), shoppingListDemandIdentity(basket))
  const store = disk(raw)
  const tab = openShoppingProgressStorageV2(reordered, store)
  assert.equal(tab.storageFormatStatus(), 'ready')
  assert.deepEqual(tab.snapshot().completedLineIds, [matched.id, other.id])
  assert.deepEqual(store.writes, [])
  assert.ok(tab.reloadSaved({ requireSameDemand: true }))
  assert.deepEqual(tab.snapshot().completedLineIds, [matched.id, other.id])
  tab.rebase({ ...reordered, totalCents: reordered.totalCents + 1 })
  assert.deepEqual(tab.snapshot().completedLineIds, [matched.id, other.id])
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(store.items.get(storageKey)).doneLineIds, [matched.id, other.id])
})

test('post-reorder explicit uncheck survives serialization rather than reviving a saved tick', () => {
  const raw = serializeShoppingProgressV2(basket, [matched.id])
  assert.ok(raw)
  const store = disk(raw)
  const reordered = { ...basket, lines: [...basket.lines].reverse() }
  const tab = openShoppingProgressStorageV2(reordered, store)
  assert.deepEqual(tab.snapshot().completedLineIds, [matched.id])
  tab.toggle(matched.id)
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(store.items.get(storageKey)).doneLineIds, [])
  assert.equal(shoppingListDemandIdentity(reordered), JSON.parse(store.items.get(storageKey)).demandIdentity)
})
