import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'

// Independent QA on exact original product integration head #1158.
// All prices and products below are synthetic M2 fixtures, NOT observed store data.
function basket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays: m2DefaultActiveDays,
  })
}
function assertRejected(current, context) {
  assert.equal(isTrustworthyShoppingBasket(current), false, context + ': existing live trust gate')
  assert.equal(buildShoppingListCopyText(current), null, context + ': direct copy helper must also abstain')
}

test('positive control: real M2 synthetic basket stays copyable without monetary claims or mutation', () => {
  const original = basket()
  assert.equal(isTrustworthyShoppingBasket(original), true)
  const snapshot = structuredClone(original)
  const result = buildShoppingListCopyText(original)
  assert.ok(result?.startsWith('Boodschappenlijst — '))
  assert.doesNotMatch(result, /€|bespar|prijsverschil/i)
  assert.deepEqual(original, snapshot)
})

test('copy helper must reject a forged basket cent total even if each product line is correct', () => {
  const original = basket()
  const wrong = { ...original, totalCents: original.totalCents + 1 }
  assertRejected(wrong, 'one-cent total drift')
  assertRejected({ ...original, totalCents: -1 }, 'negative total')
  assertRejected({ ...original, totalCents: NaN }, 'nonfinite total')
})

test('copy helper must reject zero selected meals paired with nonempty lines or inconsistent counts', () => {
  const original = basket()
  assert.ok(original.lines.length > 0)
  assertRejected({ ...original, selectedMealCount: 0 }, 'unplanned but populated')
  assertRejected({ ...original, selectedMealCount: -1 }, 'negative selected meals')
  assertRejected({ ...original, matchedLineCount: original.matchedLineCount + 1 }, 'forged line counter')
})

test('copy helper must reject overbuying an extra pack even when cents are arithmetically coherent', () => {
  const original = basket()
  const index = original.lines.findIndex(line => line.status === 'matched')
  assert.ok(index >= 0)
  const chosen = original.lines[index]
  assert.equal(chosen.status, 'matched')
  const wrong = structuredClone(original)
  wrong.lines[index].packs += 1
  wrong.lines[index].lineTotalCents += chosen.pricePerPackCents
  wrong.totalCents += chosen.pricePerPackCents
  assertRejected(wrong, 'unnecessary physical pack')
})

test('copy helper keeps a valid zero-meal, zero-line state usable', () => {
  const empty = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays: [],
  })
  assert.equal(isTrustworthyShoppingBasket(empty), true)
  assert.match(buildShoppingListCopyText(empty), /Er zijn nog geen boodschappen gepland/)
})
