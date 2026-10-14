import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { startShoppingProgressSessionV2 } from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'

function fixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, activeDays: ['Di'],
    plan: m2InitialPlan, recipes: m2Recipes,
  })
}

function unresolved(unit, amount) {
  const basket = structuredClone(fixture())
  basket.lines[0].status = 'unresolved'
  basket.lines[0].requirement = { amount, unit }
  return basket
}

test('product #1809 expected RED: unknown requirement is readable Dutch without invented money', () => {
  const basket = unresolved('unknown', null)
  const before = structuredClone(basket)
  const session = startShoppingProgressSessionV2(basket, null)
  const rows = shoppingListRowsV2(basket, session)
  assert.equal(rows[0].quantity, '? onbekend · handmatig kiezen')
  assert.equal(rows[0].unresolved, true)
  assert.equal(rows[0].label, basket.lines[0].ingredientLabel)
  assert.ok(rows.every((row) => !row.quantity.includes('€')))
  assert.deepEqual(basket, before)
})

test('product #1809 expected RED: unresolved piece quantities use Dutch singular and plural', () => {
  for (const [amount, expected] of [[1, 'stuk'], [3, 'stuks']]) {
    const basket = unresolved('piece', amount)
    const rows = shoppingListRowsV2(basket, startShoppingProgressSessionV2(basket, null))
    assert.equal(rows[0].quantity, amount + ' ' + expected + ' · handmatig kiezen')
  }
})

test('product #1809 expected RED: matched pack pieces use Dutch singular and plural', () => {
  for (const [amount, expected] of [[1, 'stuk'], [4, 'stuks']]) {
    const basket = fixture()
    const matched = basket.lines.find((row) => row.status === 'matched')
    assert.ok(matched)
    matched.pack.unit = 'piece'
    matched.pack.amount = amount
    const before = structuredClone(basket)
    const identityBefore = shoppingListDemandIdentity(basket)
    const state = startShoppingProgressSessionV2(basket, null)
    const row = shoppingListRowsV2(basket, state).find((item) => item.id === matched.id)
    assert.ok(row)
    assert.equal(row.quantity, matched.packs + ' × ' +
      (matched.pack.count > 1 ? matched.pack.count + ' × ' : '') +
      amount + ' ' + expected)
    assert.equal(shoppingListDemandIdentity(basket), identityBefore)
    assert.deepEqual(basket, before)
  }
})

test('product #1809: metric units stay canonical while quantity presentation stays read-only', () => {
  const basket = fixture()
  const matched = basket.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  matched.pack.unit = 'ml'
  matched.pack.amount = 250
  const before = structuredClone(basket)
  const session = startShoppingProgressSessionV2(basket, null)
  const row = shoppingListRowsV2(basket, session).find((item) => item.id === matched.id)
  assert.ok(row)
  assert.ok(row.quantity.endsWith('250 ml'))
  assert.deepEqual(basket, before)
  assert.equal(typeof shoppingListDemandIdentity(basket), 'string')
})
