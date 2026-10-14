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

function basket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

test('shopping ticks are scoped to store identity even when demands and prices match', () => {
  const original = basket()
  assert.ok(original.lines.length > 0)
  const saved = serializeShoppingListProgress(original, [original.lines[0].id])
  const otherStore = {
    ...original,
    store: { ...original.store, id: original.store.id + '-other' },
  }

  assert.notEqual(shoppingListBasketKey(original), shoppingListBasketKey(otherStore))
  assert.deepEqual(restoreShoppingListProgress(otherStore, saved), [])
  assert.deepEqual(restoreShoppingListProgress(original, saved), [original.lines[0].id])
})

test('shopping ticks are not silently applied to a reordered basket', () => {
  const original = basket()
  assert.ok(original.lines.length > 1)
  const saved = serializeShoppingListProgress(original, [original.lines[0].id])
  const reordered = { ...original, lines: [...original.lines].reverse() }

  assert.notEqual(shoppingListBasketKey(original), shoppingListBasketKey(reordered))
  assert.deepEqual(restoreShoppingListProgress(reordered, saved), [])
})

test('shopping ticks do not survive a matched-to-unresolved line transition', () => {
  const original = basket()
  const matchedIndex = original.lines.findIndex((line) => line.status === 'matched')
  assert.ok(matchedIndex >= 0)
  const matched = original.lines[matchedIndex]
  const saved = serializeShoppingListProgress(original, [matched.id])
  const unresolved = {
    ...original,
    lines: original.lines.map((line, index) =>
      index === matchedIndex
        ? { id: line.id, status: 'unresolved', requirement: line.requirement }
        : line,
    ),
  }

  assert.notEqual(shoppingListBasketKey(original), shoppingListBasketKey(unresolved))
  assert.deepEqual(restoreShoppingListProgress(unresolved, saved), [])
})
