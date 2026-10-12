import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import {
  openShoppingProgressStorageV2,
} from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  restoreShoppingProgressV2, shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Product-core #1056: independent demand-boundary acceptance on frozen routed
// v2 candidate #1538. Synthetic M2 baskets, no retailer or browser evidence.
// Intentionally does not touch v1 storage, App, or any owner-managed sources.
const baseBasket = () => buildOneStoreBasket({
  store: m2Store,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays: m2DefaultActiveDays,
  products: m2Products,
})

function storagePort() {
  const saved = new Map()
  const writes = []
  return {
    saved, writes,
    port: {
      getItem(key) { return saved.get(key) ?? null },
      setItem(key, value) { writes.push({ key, value }); saved.set(key, value) },
    },
  }
}

function checkedController(basket, port) {
  const controller = openShoppingProgressStorageV2(basket, port)
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  const id = basket.lines.find((line) => line.status === 'matched')?.id
  assert.ok(id, 'controlled M2 fixture must include a matched physical item')
  assert.deepEqual(controller.toggle(id).completedLineIds, [id])
  assert.equal(controller.persist(), true)
  return { controller, id }
}

test('product #1056: reorder plus repricing preserves the same durable physical checklist', () => {
  const initial = baseBasket()
  const { port, saved, writes } = storagePort()
  const { controller, id } = checkedController(initial, port)
  const originalBytes = saved.get(shoppingListProgressV2StorageKey)
  assert.equal(writes.length, 1)

  // Rendering order and financial observations are not purchases of new items.
  const repriced = structuredClone(initial)
  repriced.lines.reverse()
  const purchased = repriced.lines.find((line) => line.id === id)
  purchased.pricePerPackCents += 1
  purchased.lineTotalCents += purchased.packs
  repriced.totalCents += purchased.packs

  assert.equal(shoppingListDemandIdentity(repriced), shoppingListDemandIdentity(initial))
  const next = controller.rebase(repriced)
  assert.deepEqual(next.completedLineIds, [id])
  assert.equal(shoppingListRowsV2(repriced, next).find((row) => row.id === id).checked, true)
  assert.equal(writes.length, 1, 'a passive price/reorder event must not write')
  assert.equal(saved.get(shoppingListProgressV2StorageKey), originalBytes)
  assert.deepEqual(restoreShoppingProgressV2(repriced, originalBytes), [id])
  assert.deepEqual(openShoppingProgressStorageV2(repriced, port).snapshot().completedLineIds, [id])
})

test('product #1056: another shop is another task even with identical product lines', () => {
  const initial = baseBasket()
  const { port, saved, writes } = storagePort()
  const { controller, id } = checkedController(initial, port)
  const oldBytes = saved.get(shoppingListProgressV2StorageKey)
  const anotherStore = structuredClone(initial)
  anotherStore.store.id = initial.store.id + '-another-location'

  assert.notEqual(shoppingListDemandIdentity(anotherStore), shoppingListDemandIdentity(initial))
  assert.deepEqual(restoreShoppingProgressV2(anotherStore, oldBytes), [])
  assert.deepEqual(controller.rebase(anotherStore).completedLineIds, [])
  assert.equal(shoppingListRowsV2(anotherStore, controller.snapshot()).find((row) => row.id === id).checked, false)
  assert.equal(controller.persist(), true)
  assert.equal(writes.length, 2)
  assert.deepEqual(openShoppingProgressStorageV2(anotherStore, port).snapshot().completedLineIds, [])
  assert.deepEqual(openShoppingProgressStorageV2(initial, port).snapshot().completedLineIds, [],
    'returning to the old shop must never revive the previous round')
})

test('product #1056: a different selected product or pack count resets completed rows', () => {
  for (const mutation of [
    (line) => { line.productId += '-alternative' },
    (line) => { line.packs += 1 },
    (line) => { line.pack.count += 1 },
  ]) {
    const initial = baseBasket()
    const { port, saved } = storagePort()
    const { controller, id } = checkedController(initial, port)
    const before = saved.get(shoppingListProgressV2StorageKey)
    const changed = structuredClone(initial)
    const product = changed.lines.find((line) => line.id === id)
    mutation(product)

    assert.notEqual(shoppingListDemandIdentity(changed), shoppingListDemandIdentity(initial))
    assert.deepEqual(restoreShoppingProgressV2(changed, before), [])
    const rebased = controller.rebase(changed)
    assert.deepEqual(rebased.completedLineIds, [])
    assert.equal(shoppingListRowsV2(changed, rebased).find((row) => row.id === id).checked, false)
    assert.equal(controller.persist(), true)
    assert.deepEqual(openShoppingProgressStorageV2(changed, port).snapshot().completedLineIds, [])
  }
})

test('product #1056: losing a trusted match invalidates stale product completion', () => {
  const initial = baseBasket()
  const { port, saved } = storagePort()
  const { controller, id } = checkedController(initial, port)
  const prior = saved.get(shoppingListProgressV2StorageKey)
  const unresolved = structuredClone(initial)
  const formerlyMatched = unresolved.lines.find((line) => line.id === id)
  formerlyMatched.status = 'unresolved'
  formerlyMatched.productId = null
  formerlyMatched.productName = null
  formerlyMatched.pack = null
  formerlyMatched.packs = null
  formerlyMatched.pricePerPackCents = null
  formerlyMatched.lineTotalCents = null

  assert.notEqual(shoppingListDemandIdentity(unresolved), shoppingListDemandIdentity(initial))
  assert.deepEqual(restoreShoppingProgressV2(unresolved, prior), [])
  const changed = controller.rebase(unresolved)
  assert.deepEqual(changed.completedLineIds, [])
  const row = shoppingListRowsV2(unresolved, changed).find((item) => item.id === id)
  assert.equal(row.unresolved, true)
  assert.equal(row.checked, false)
  assert.equal(controller.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(unresolved, port).snapshot().completedLineIds, [])
})

test('product #1056: requirement quantity change resets even if pack purchase count stays equal', () => {
  const initial = baseBasket()
  const { port, saved } = storagePort()
  const { controller, id } = checkedController(initial, port)
  const savedBefore = saved.get(shoppingListProgressV2StorageKey)
  const changed = structuredClone(initial)
  const line = changed.lines.find((item) => item.id === id)
  const originalPacks = line.packs
  line.requirement.amount += 1

  assert.equal(line.packs, originalPacks, 'quantity differs while the purchased pack count is unchanged')
  assert.notEqual(shoppingListDemandIdentity(changed), shoppingListDemandIdentity(initial))
  assert.deepEqual(restoreShoppingProgressV2(changed, savedBefore), [])
  assert.deepEqual(controller.rebase(changed).completedLineIds, [])
  assert.equal(controller.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(changed, port).snapshot().completedLineIds, [])
})

test('product #1056: product display-name correction never discards the purchased check', () => {
  const initial = baseBasket()
  const { port, saved, writes } = storagePort()
  const { controller, id } = checkedController(initial, port)
  const savedBefore = saved.get(shoppingListProgressV2StorageKey)
  const corrected = structuredClone(initial)
  const line = corrected.lines.find((item) => item.id === id)
  line.productName += ' (etiketcorrectie)'
  line.ingredientLabel += ' (gecorrigeerd)'

  assert.equal(shoppingListDemandIdentity(corrected), shoppingListDemandIdentity(initial))
  const next = controller.rebase(corrected)
  const row = shoppingListRowsV2(corrected, next).find((item) => item.id === id)
  assert.equal(row.checked, true)
  assert.match(row.label, /etiketcorrectie/)
  assert.equal(saved.get(shoppingListProgressV2StorageKey), savedBefore)
  assert.equal(writes.length, 1, 'nonphysical name change must not trigger a save')
  assert.deepEqual(openShoppingProgressStorageV2(corrected, port).snapshot().completedLineIds, [id])
})
