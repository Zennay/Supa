import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Product-core #1056, review-only expected-RED on current main.
// The existing v1 key includes prices. These are synthetic M2 cents, not
// retailer observations or M3 savings evidence. Never merge RED by itself.
// Changing the persisted identity requires explicit owner-led v2 migration.
const basketFor = (products = m2Products, store = m2Store) =>
  buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })

const physicalLines = (basket) =>
  basket.lines.map((line) => line.status === 'matched'
    ? {
        id: line.id, status: line.status, amount: line.requirement.amount,
        unit: line.requirement.unit, productId: line.productId,
        packs: line.packs, pack: line.pack,
      }
    : {
        id: line.id, status: line.status, amount: line.requirement.amount,
        unit: line.requirement.unit,
      })

const priceOnly = (productId, cents) =>
  m2Products.map((product) => product.id === productId
    ? { ...product, priceCents: product.priceCents + cents }
    : product)

test('product #1056 RED: one-cent price refresh preserves the same physical checklist identity', () => {
  const before = basketFor()
  const after = basketFor(priceOnly('basmati-1kg', 1))
  assert.equal(before.matchedLineCount, after.matchedLineCount)
  assert.deepEqual(physicalLines(after), physicalLines(before))
  assert.notEqual(after.totalCents, before.totalCents)
  assert.equal(
    shoppingListBasketKey(after),
    shoppingListBasketKey(before),
    'only money changed: completed physical shopping tasks must retain identity',
  )
})

test('product #1056 RED: already checked rice survives price-only refresh on next load', () => {
  const before = basketFor()
  const rice = before.lines.find((line) =>
    line.status === 'matched' && line.id === 'basmati-rice')
  assert.ok(rice, 'M2 must match the existing rice requirement')
  const originalProgress = serializeShoppingListProgress(before, [rice.id])
  const after = basketFor(priceOnly('basmati-1kg', 1))
  assert.deepEqual(physicalLines(after), physicalLines(before))
  assert.deepEqual(
    restoreShoppingListProgress(after, originalProgress),
    [rice.id],
    'a price-only refresh must not uncheck a physically unchanged item',
  )
})

test('product #1056 control: a genuinely larger pack demand must not reuse checked tasks', () => {
  const before = basketFor()
  const rice = before.lines.find((line) =>
    line.status === 'matched' && line.id === 'basmati-rice')
  assert.ok(rice)
  const originalProgress = serializeShoppingListProgress(before, [rice.id])
  const after = basketFor(m2Products.map((product) => product.id === 'basmati-1kg'
    ? { ...product, packAmount: 0.25, packUnit: 'kg' }
    : product))
  const riceAfter = after.lines.find((line) => line.id === rice.id)
  assert.ok(riceAfter && riceAfter.status === 'matched')
  assert.notEqual(riceAfter.packs, rice.packs)
  assert.notEqual(shoppingListBasketKey(after), shoppingListBasketKey(before))
  assert.deepEqual(restoreShoppingListProgress(after, originalProgress), [])
})

test('product #1056 control: foreign store and unsupported future record never carry old ticks', () => {
  const before = basketFor()
  const raw = serializeShoppingListProgress(before, [before.lines[0].id])
  const foreignStore = { id: 'm2-other-demo-store', name: 'Andere testwinkel' }
  const elsewhere = basketFor(m2Products.map((product) =>
    ({ ...product, storeId: foreignStore.id })), foreignStore)
  assert.notEqual(shoppingListBasketKey(elsewhere), shoppingListBasketKey(before))
  assert.deepEqual(restoreShoppingListProgress(elsewhere, raw), [])
  assert.deepEqual(restoreShoppingListProgress(before, JSON.stringify({
    schemaVersion: 2,
    basketKey: shoppingListBasketKey(before),
    doneLineIds: [before.lines[0].id],
  })), [])
})
