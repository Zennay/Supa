import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import {
  reconcileShoppingProgressV2,
  restoreShoppingProgressV2,
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { serializeShoppingListProgress } from '../src/features/shopping-list/shoppingListProgress.ts'

function basket(products = m2Products, activeDays = ['Di'], store = m2Store) {
  return buildOneStoreBasket({
    store,
    products,
    activeDays,
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

function repricedBasket(before) {
  const match = before.lines.find((line) => line.status === 'matched')
  assert.ok(match)
  return basket(m2Products.map((product) =>
    product.id === match.productId
      ? { ...product, priceCents: product.priceCents + 1 }
      : product,
  ))
}

test('v2 has an independent versioned storage key; never parse v1 state as v2', () => {
  assert.equal(shoppingListProgressV2StorageKey, 'supa:shopping-list-progress:v2')
  const before = basket()
  const checked = before.lines[0].id
  const v1 = serializeShoppingListProgress(before, [checked])
  assert.deepEqual(restoreShoppingProgressV2(before, v1), [])
  const spoofed = JSON.parse(v1)
  spoofed.schemaVersion = 2
  assert.deepEqual(restoreShoppingProgressV2(before, JSON.stringify(spoofed)), [])
})

test('same physical task retains progress across exact-cent product repricing on reload', () => {
  const before = basket()
  const after = repricedBasket(before)
  assert.notEqual(before.totalCents, after.totalCents)

  const completed = [before.lines[0].id, before.lines[1].id]
  const stored = serializeShoppingProgressV2(before, completed)
  assert.ok(stored)
  assert.deepEqual(restoreShoppingProgressV2(after, stored), completed)
  assert.deepEqual(reconcileShoppingProgressV2(before, after, completed), completed)
})

test('same-session and reload invalidate ticks when product, packs, store or demand changes', () => {
  const before = basket()
  const completed = [before.lines[0].id]
  const raw = serializeShoppingProgressV2(before, completed)
  assert.ok(raw)

  const differentStore = structuredClone(before)
  differentStore.store.id = 'different-store'
  const otherItem = structuredClone(before)
  const match = otherItem.lines.find((line) => line.status === 'matched')
  assert.ok(match)
  match.productId += '-other'
  const morePacks = structuredClone(before)
  const packing = morePacks.lines.find((line) => line.status === 'matched')
  assert.ok(packing)
  packing.packs += 1
  const moreDays = basket(m2Products, ['Di', 'Wo'])

  for (const changed of [differentStore, otherItem, morePacks, moreDays]) {
    assert.deepEqual(restoreShoppingProgressV2(changed, raw), [])
    assert.deepEqual(reconcileShoppingProgressV2(before, changed, completed), [])
  }
})

test('completed lines are unique, current and preserve first-click order', () => {
  const before = basket()
  const second = before.lines[1].id
  const first = before.lines[0].id
  const candidates = [second, second, 'stale', null, 7, first, first]
  const saved = serializeShoppingProgressV2(before, candidates)
  assert.ok(saved)
  assert.deepEqual(restoreShoppingProgressV2(before, saved), [second, first])
  assert.deepEqual(reconcileShoppingProgressV2(before, before, candidates), [second, first])
})

test('malformed JSON/state or malformed basket never restores or persists completed items', () => {
  const before = basket()
  const saved = serializeShoppingProgressV2(before, [before.lines[0].id])
  assert.ok(saved)
  const parsed = JSON.parse(saved)
  for (const raw of [
    null,
    '',
    '{bad-json',
    'null',
    '[]',
    JSON.stringify({ ...parsed, schemaVersion: 1 }),
    JSON.stringify({ ...parsed, demandIdentity: 'different' }),
    JSON.stringify({ ...parsed, doneLineIds: {} }),
    JSON.stringify({ ...parsed, doneLineIds: 'not-array' }),
  ]) {
    assert.deepEqual(restoreShoppingProgressV2(before, raw), [])
  }

  for (const invalid of [
    { ...before, store: { id: '' } },
    { ...before, lines: null },
    { ...before, lines: [null] },
  ]) {
    assert.equal(serializeShoppingProgressV2(invalid, [before.lines[0].id]), null)
    assert.deepEqual(restoreShoppingProgressV2(invalid, saved), [])
    assert.deepEqual(reconcileShoppingProgressV2(before, invalid, [before.lines[0].id]), [])
  }
})

test('an empty week cannot resurrect stale progress', () => {
  const before = basket()
  const blank = basket(m2Products, [])
  const raw = serializeShoppingProgressV2(before, [before.lines[0].id])
  assert.ok(raw)
  assert.deepEqual(restoreShoppingProgressV2(blank, raw), [])
  assert.deepEqual(reconcileShoppingProgressV2(before, blank, [before.lines[0].id]), [])
  const emptyRaw = serializeShoppingProgressV2(blank, [])
  assert.ok(emptyRaw)
  assert.deepEqual(restoreShoppingProgressV2(blank, emptyRaw), [])
})

test('display reordering retains completed items in memory and on reload', () => {
  const before = basket()
  assert.ok(before.lines.length > 1)
  const completed = [before.lines[0].id, before.lines[1].id]
  const raw = serializeShoppingProgressV2(before, completed)
  assert.ok(raw)

  const after = structuredClone(before)
  after.lines.reverse()
  assert.deepEqual(reconcileShoppingProgressV2(before, after, completed), completed)
  assert.deepEqual(restoreShoppingProgressV2(after, raw), completed)
  assert.deepEqual(restoreShoppingProgressV2(before, serializeShoppingProgressV2(after, completed)), completed)
})
