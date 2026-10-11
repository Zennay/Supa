import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2Store, m2InitialPlan, m2Recipes, m2Products, m2DefaultActiveDays,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function withLine(current, changes) {
  return {
    ...current,
    lines: current.lines.map((line, index) => index === 0 ? { ...line, ...changes } : line),
  }
}

test('isolated Unicode variation selector cannot be a store identity [RED]', () => {
  const original = basket()
  assert.equal(buildShoppingListCopyText({
    ...original, store: { ...original.store, name: '\uFE0F' },
  }), null)
})

test('isolated Unicode combining acute cannot be a store identity [RED]', () => {
  const original = basket()
  assert.equal(buildShoppingListCopyText({
    ...original, store: { ...original.store, name: '\u0301' },
  }), null)
})

test('format-only soft hyphen cannot be a store identity [RED]', () => {
  const original = basket()
  assert.equal(buildShoppingListCopyText({
    ...original, store: { ...original.store, name: '\u00AD' },
  }), null)
})

test('Arabic vowel mark without a lexical base cannot name a shopping item [RED]', () => {
  assert.equal(buildShoppingListCopyText(
    withLine(basket(), { ingredientLabel: '\u0650' }),
  ), null)
})

test('variation-only product cannot be copied as a purchased product [RED]', () => {
  const original = basket()
  const lines = original.lines.map(line => line.status === 'matched'
    ? { ...line, productName: '\uFE0F' } : line)
  assert.equal(buildShoppingListCopyText({ ...original, lines }), null)
})

test('legitimate visible base plus combining accent and emoji selector survive [control]', () => {
  const original = basket()
  const store = { ...original.store, name: 'Winkel 🛒\uFE0F' }
  const lines = original.lines.map(line => line.status === 'matched'
    ? { ...line, productName: 'Cafe\u0301' } : line)
  const before = JSON.stringify(original)
  const copied = buildShoppingListCopyText({ ...original, store, lines })
  assert.ok(copied)
  assert.match(copied, /Winkel 🛒/)
  assert.match(copied, /Cafe\u0301/)
  assert.doesNotMatch(copied, /€|besparing|prijsverschil/i)
  assert.equal(JSON.stringify(original), before)
})
