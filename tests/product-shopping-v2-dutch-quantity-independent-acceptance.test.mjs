import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { startShoppingProgressSessionV2, toggleShoppingProgressSessionV2 } from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'

function fixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: ['Di'], recipes: m2Recipes,
  })
}

test('independent product #1809: unresolved unknown stays an honest Dutch manual-choice row', () => {
  const basket = fixture()
  const row = basket.lines[0]
  row.status = 'unresolved'
  row.requirement = { amount: null, unit: 'unknown' }
  const original = structuredClone(basket)
  const identity = shoppingListDemandIdentity(basket)
  const session = startShoppingProgressSessionV2(basket, null)
  const display = shoppingListRowsV2(basket, session)
  assert.equal(display[0].quantity, '? onbekend · handmatig kiezen')
  assert.equal(display[0].label, row.ingredientLabel)
  assert.equal(display[0].unresolved, true)
  assert.equal(display[0].checked, false)
  assert.equal(shoppingListDemandIdentity(basket), identity)
  assert.deepEqual(basket, original)
})

test('independent product #1809: a multipack of pieces uses plural per-pack unit only', () => {
  const basket = fixture()
  const matched = basket.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  matched.packs = 2
  matched.pack = { ...matched.pack, unit: 'piece', amount: 3, count: 4 }
  const original = structuredClone(basket)
  const physical = shoppingListDemandIdentity(basket)
  assert.equal(typeof physical, 'string')
  const state = startShoppingProgressSessionV2(basket, null)
  const row = shoppingListRowsV2(basket, state).find((candidate) => candidate.id === matched.id)
  assert.ok(row)
  assert.equal(row.quantity, '2 × 4 × 3 stuks')
  assert.equal(row.label, matched.productName)
  assert.deepEqual(basket, original)
  assert.equal(shoppingListDemandIdentity(basket), physical)
})

test('independent product #1809: gram and litre remain metric, while one piece stays singular', () => {
  for (const [unit, amount, expected] of [
    ['g', 400, '400 g'],
    ['l', 1.5, '1.5 l'],
    ['piece', 1, '1 stuk'],
  ]) {
    const basket = fixture()
    const matched = basket.lines.find((line) => line.status === 'matched')
    assert.ok(matched)
    matched.pack.unit = unit
    matched.pack.amount = amount
    matched.pack.count = 1
    const state = startShoppingProgressSessionV2(basket, null)
    const row = shoppingListRowsV2(basket, state).find((item) => item.id === matched.id)
    assert.ok(row)
    assert.ok(row.quantity.endsWith(expected), unit)
    assert.equal(row.unresolved, false)
    assert.equal(row.quantity.includes('€'), false)
  }
})

test('independent product #1809: localized text does not rebase price-only ticks or retain changed packs', () => {
  const basket = fixture()
  const matched = basket.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  matched.pack.unit = 'piece'
  matched.pack.amount = 1
  const initial = startShoppingProgressSessionV2(basket, null)
  const ticked = toggleShoppingProgressSessionV2(initial, basket, matched.id)
  const identity = shoppingListDemandIdentity(basket)
  const repriced = structuredClone(basket)
  const target = repriced.lines.find((line) => line.id === matched.id)
  assert.ok(target && target.status === 'matched')
  target.pricePerPackCents += 2
  target.lineTotalCents += 2 * target.packs
  repriced.totalCents += 2 * target.packs
  assert.equal(shoppingListDemandIdentity(repriced), identity)
  assert.equal(shoppingListRowsV2(repriced, ticked).find((row) => row.id === matched.id).checked, true)

  const changed = structuredClone(basket)
  const changedTarget = changed.lines.find((line) => line.id === matched.id)
  assert.ok(changedTarget && changedTarget.status === 'matched')
  changedTarget.pack.amount += 1
  assert.notEqual(shoppingListDemandIdentity(changed), identity)
  assert.equal(shoppingListRowsV2(changed, ticked).find((row) => row.id === matched.id).checked, false)
})
