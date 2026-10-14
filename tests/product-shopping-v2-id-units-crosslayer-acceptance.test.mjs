import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { startShoppingProgressSessionV2, toggleShoppingProgressSessionV2 } from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'

// Independent composition of product-core #1805 and #1809. Every shopping
// basket is generated from synthetic M2 fixtures, never live shop evidence.
function fixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: ['Di'],
  })
}

test('integrated shopping-v2: blank physical ID cannot be made displayable by Dutch piece labels', () => {
  const basket = fixture()
  const row = basket.lines.find(item => item.status === 'matched')
  assert.ok(row)
  row.productId = '\u3164'
  row.pack = { ...row.pack, amount: 1, unit: 'piece' }
  const before = structuredClone(basket)
  const state = startShoppingProgressSessionV2(basket, null)
  assert.equal(shoppingListDemandIdentity(basket), null)
  assert.deepEqual(shoppingListRowsV2(basket, state), [])
  assert.deepEqual(basket, before)
})

test('integrated shopping-v2: readable Braille product, Dutch units and price-only ticks coexist', () => {
  const basket = fixture()
  const row = basket.lines.find(item => item.status === 'matched')
  assert.ok(row)
  row.productId = '⠃⠗⠇'
  row.pack = { ...row.pack, amount: 1, unit: 'piece' }
  const before = structuredClone(basket)
  const key = shoppingListDemandIdentity(basket)
  assert.equal(typeof key, 'string')
  const state = startShoppingProgressSessionV2(basket, null)
  const ticked = toggleShoppingProgressSessionV2(state, basket, row.id)
  const originalRow = shoppingListRowsV2(basket, ticked).find(item => item.id === row.id)
  assert.ok(originalRow)
  assert.match(originalRow.quantity, / stuk$/)
  assert.equal(originalRow.checked, true)
  const repriced = structuredClone(basket)
  const updated = repriced.lines.find(item => item.id === row.id)
  assert.ok(updated && updated.status === 'matched')
  updated.pricePerPackCents += 1
  updated.lineTotalCents += updated.packs
  repriced.totalCents += updated.packs
  assert.equal(shoppingListDemandIdentity(repriced), key)
  assert.equal(shoppingListRowsV2(repriced, ticked).find(item => item.id === row.id).checked, true)
  assert.deepEqual(basket, before)
})

test('integrated shopping-v2: honest unknown unit is localized but invisible unresolved identity is rejected', () => {
  const basket = fixture()
  const row = basket.lines.find(item => item.status === 'matched')
  assert.ok(row)
  row.status = 'unresolved'
  row.requirement = { amount: null, unit: 'unknown' }
  const state = startShoppingProgressSessionV2(basket, null)
  const display = shoppingListRowsV2(basket, state).find(item => item.id === row.id)
  assert.ok(display)
  assert.equal(display.quantity, '? onbekend · handmatig kiezen')
  assert.equal(display.unresolved, true)
  assert.equal(display.quantity.includes('€'), false)

  const invisible = structuredClone(basket)
  const changed = invisible.lines.find(item => item.id === row.id)
  assert.ok(changed)
  changed.id = '\u2800'
  assert.equal(shoppingListDemandIdentity(invisible), null)
  assert.deepEqual(shoppingListRowsV2(invisible, state), [])
})
