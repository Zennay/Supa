import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import { serializeShoppingListProgress } from '../src/features/shopping-list/shoppingListProgress.ts'
import {
  rebaseShoppingProgressSessionV2,
  startShoppingProgressSessionV2,
  toggleShoppingProgressSessionV2,
} from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'
import { restoreShoppingProgressV2 } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket({
  prices = m2Products,
  days = ['Di'],
  store = m2Store,
} = {}) {
  return buildOneStoreBasket({
    store,
    products: prices,
    activeDays: days,
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

function assertClean(session, expected = []) {
  assert.deepEqual(session.completedLineIds, expected)
  if (session.serialized !== null) {
    assert.deepEqual(JSON.parse(session.serialized).doneLineIds, expected)
  }
}

test('actual one-store price refresh keeps ticks across session and reload, but updates money', () => {
  const original = basket()
  const line = original.lines.find((row) => row.status === 'matched')
  assert.ok(line)
  const first = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(original, null),
    original,
    line.id,
  )
  assertClean(first, [line.id])

  for (const delta of [1, -1, 17, 149]) {
    const prices = m2Products.map((product) =>
      product.id === line.productId
        ? { ...product, priceCents: product.priceCents + delta }
        : product,
    )
    const next = basket({ prices })
    assert.notEqual(next.totalCents, original.totalCents)
    const rebased = rebaseShoppingProgressSessionV2(first, next)
    assertClean(rebased, [line.id])
    assert.deepEqual(restoreShoppingProgressV2(next, rebased.serialized), [line.id])
    assertClean(startShoppingProgressSessionV2(next, first.serialized), [line.id])
  }
})

test('in-place edits cannot bypass the previously pinned physical identity', () => {
  const original = basket()
  const checked = original.lines[0].id
  const session = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(original, null), original, checked,
  )
  assertClean(session, [checked])
  const changedInPlace = original
  const matched = changedInPlace.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  matched.pack.amount *= 2
  const after = rebaseShoppingProgressSessionV2(session, changedInPlace)
  assert.notEqual(after.demandIdentity, session.demandIdentity)
  assertClean(after, [])
})

test('store, week demand and selected product changes clear ticks but a display reorder does not', () => {
  const original = basket()
  const firstId = original.lines[0].id
  const initial = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(original, null), original, firstId,
  )
  const reorder = structuredClone(original)
  reorder.lines.reverse()
  assertClean(rebaseShoppingProgressSessionV2(initial, reorder), [firstId])

  const otherShop = structuredClone(original)
  otherShop.store.id = 'synthetic-other-store'
  const productSwap = structuredClone(original)
  const row = productSwap.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  row.productId += '-different'

  for (const changed of [otherShop, productSwap, basket({ days: ['Di', 'Wo'] })]) {
    const result = rebaseShoppingProgressSessionV2(initial, changed)
    assertClean(result, [])
    assert.deepEqual(restoreShoppingProgressV2(changed, initial.serialized), [])
  }
})

test('a toggle on a new physical task never carries old ticks into the changed basket', () => {
  const original = basket()
  const ids = original.lines.slice(0, 2).map((line) => line.id)
  assert.equal(ids.length, 2)
  let state = startShoppingProgressSessionV2(original, null)
  for (const id of ids) state = toggleShoppingProgressSessionV2(state, original, id)
  assertClean(state, ids)
  const changed = basket({ days: ['Di', 'Wo'] })
  const result = toggleShoppingProgressSessionV2(state, changed, ids[0])
  assertClean(result, [ids[0]])
  assert.notEqual(result.demandIdentity, state.demandIdentity)
  assertClean(toggleShoppingProgressSessionV2(result, changed, ids[0]), [])
})

test('legacy v1 migration requires explicit opt-in, current exact key and no v2 snapshot', () => {
  const original = basket()
  const checked = original.lines[0].id
  const rawV1 = serializeShoppingListProgress(original, [checked])
  assertClean(startShoppingProgressSessionV2(original, null, { rawV1 }), [])
  assertClean(startShoppingProgressSessionV2(original, null, {
    rawV1,
    allowLegacyUpgrade: true,
  }), [checked])
  assert.equal(startShoppingProgressSessionV2(original, null, {
    rawV1,
    allowLegacyUpgrade: true,
  }).upgradedFromLegacy, true)

  const poisonedV2 = '{"schemaVersion":2,"demandIdentity":"other","doneLineIds":["' + checked + '"]}'
  const corrupt = startShoppingProgressSessionV2(original, poisonedV2, {
    rawV1,
    allowLegacyUpgrade: true,
  })
  assertClean(corrupt, [])
  assert.equal(corrupt.upgradedFromLegacy, false)
  assertClean(startShoppingProgressSessionV2(original, 'not-json', {
    rawV1,
    allowLegacyUpgrade: true,
  }), [])
})

test('stale-priced v1 never migrates, but a genuine v2 remains price-stable', () => {
  const original = basket()
  const first = original.lines.find((line) => line.status === 'matched')
  assert.ok(first)
  const oldV1 = serializeShoppingListProgress(original, [first.id])
  const reprice = basket({
    prices: m2Products.map((product) => product.id === first.productId
      ? { ...product, priceCents: product.priceCents + 1 }
      : product),
  })
  assertClean(startShoppingProgressSessionV2(reprice, null, {
    rawV1: oldV1,
    allowLegacyUpgrade: true,
  }), [])
  const v2 = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(original, null), original, first.id,
  )
  assertClean(startShoppingProgressSessionV2(reprice, v2.serialized), [first.id])
})

test('invalid basket cannot retain, serialize, upgrade or toggle stale checked items', () => {
  const original = basket()
  const id = original.lines[0].id
  const valid = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(original, null), original, id,
  )
  for (const broken of [
    null, {},
    { ...original, store: null },
    { ...original, lines: null },
    { ...original, lines: [null] },
  ]) {
    const fresh = startShoppingProgressSessionV2(broken, valid.serialized)
    assert.equal(fresh.demandIdentity, null)
    assert.equal(fresh.serialized, null)
    assertClean(fresh, [])
    assertClean(rebaseShoppingProgressSessionV2(valid, broken), [])
    assertClean(toggleShoppingProgressSessionV2(valid, broken, id), [])
  }
})

test('a user can only toggle line IDs present in current physical basket', () => {
  const original = basket()
  const id = original.lines[0].id
  const empty = startShoppingProgressSessionV2(original, null)
  assertClean(toggleShoppingProgressSessionV2(empty, original, 'foreign'), [])
  assertClean(toggleShoppingProgressSessionV2(empty, original, null), [])
  const checked = toggleShoppingProgressSessionV2(empty, original, id)
  assertClean(checked, [id])
  assertClean(toggleShoppingProgressSessionV2(checked, original, 'foreign'), [id])
})

test('the session API leaves basket and previously returned state unmodified', () => {
  const original = basket()
  const before = structuredClone(original)
  const state = startShoppingProgressSessionV2(original, null)
  const toggled = toggleShoppingProgressSessionV2(state, original, original.lines[0].id)
  assertClean(state, [])
  assertClean(toggled, [original.lines[0].id])
  assert.deepEqual(original, before)
})
