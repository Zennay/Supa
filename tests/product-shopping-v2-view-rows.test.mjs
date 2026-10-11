import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

function basket(products = m2Products, store = m2Store) {
  return buildOneStoreBasket({
    store,
    products,
    activeDays: ['Di'],
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

function sessionFor(b, lineId = b.lines[0].id) {
  const controller = openShoppingProgressStorageV2(b, null)
  return controller.toggle(lineId)
}

test('v2 rows keep a check during a price-only refresh before the effect rebases', () => {
  const first = basket()
  const picked = first.lines.find((row) => row.status === 'matched')
  assert.ok(picked)
  const state = sessionFor(first, picked.id)
  const repriced = basket(m2Products.map((product) =>
    product.id === picked.productId
      ? { ...product, priceCents: product.priceCents + 19 }
      : product,
  ))
  assert.notEqual(first.totalCents, repriced.totalCents)
  const rows = shoppingListRowsV2(repriced, state)
  assert.equal(rows.find((row) => row.id === picked.id).checked, true)
  assert.equal(rows.length, first.lines.length)
  assert.equal(rows.some((row) => row.quantity.includes('€')), false)
})

test('v2 rows synchronously suppress stale checks for store or pack changes', () => {
  const first = basket()
  const state = sessionFor(first)
  const differentStore = basket(m2Products, { ...m2Store, id: 'other-store' })
  const changedPack = structuredClone(first)
  const row = changedPack.lines.find((candidate) => candidate.status === 'matched')
  assert.ok(row)
  row.pack.amount += 10

  for (const changed of [differentStore, changedPack]) {
    assert.ok(shoppingListRowsV2(changed, state).every((item) => !item.checked))
  }
  assert.equal(shoppingListRowsV2(first, state)[0].checked, true)
})

test('v2 row projection preserves unresolved manual-choice language and never guesses money', () => {
  const unresolved = structuredClone(basket())
  unresolved.lines[0] = {
    ...unresolved.lines[0],
    status: 'unresolved',
    requirement: { ...unresolved.lines[0].requirement, amount: null },
  }
  const state = sessionFor(unresolved)
  const rows = shoppingListRowsV2(unresolved, state)
  assert.equal(rows[0].unresolved, true)
  assert.match(rows[0].quantity, /handmatig kiezen/)
  assert.equal(rows[0].checked, true)
  assert.equal(rows[0].label, unresolved.lines[0].ingredientLabel)
})

test('invalid basket cannot display checked progress as valid shopping rows', () => {
  const first = basket()
  const state = sessionFor(first)
  assert.deepEqual(shoppingListRowsV2({ ...first, store: null }, state), [])
  assert.deepEqual(shoppingListRowsV2({ ...first, lines: [null] }, state), [])
})

test('row projection is read-only and uses product names and exact pack quantities', () => {
  const first = basket()
  const initial = structuredClone(first)
  const state = sessionFor(first)
  const snapshot = structuredClone(state)
  const rows = shoppingListRowsV2(first, state)
  const matched = first.lines.find((row) => row.status === 'matched')
  assert.ok(matched)
  assert.equal(rows.find((row) => row.id === matched.id).label, matched.productName)
  assert.match(rows.find((row) => row.id === matched.id).quantity, / × /)
  assert.deepEqual(first, initial)
  assert.deepEqual(state, snapshot)
})
