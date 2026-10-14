import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

const INVALID = 'Invalid shopping list basket runtime shape'

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function matchedIndexOf(basketValue) {
  const index = basketValue.lines.findIndex(line => line.status === 'matched')
  assert.ok(index >= 0, 'fixture must contain a matched physical purchase')
  return index
}

function expectFailClosed(value, saved) {
  assert.deepEqual(restoreShoppingListProgress(value, saved), [])
  for (const operation of [
    () => shoppingListBasketKey(value),
    () => serializeShoppingListProgress(value, [value.lines[0].id]),
  ]) {
    assert.throws(operation, error =>
      error instanceof Error && error.message === INVALID)
  }
}

test('shopping-v1 rejects seven distinct inconsistent matched-line financial facts', async t => {
  const valid = basket()
  const index = matchedIndexOf(valid)
  const matched = valid.lines[index]
  assert.ok(matched.pricePerPackCents > 0)
  assert.ok(matched.lineTotalCents > 0)
  const originalRaw = serializeShoppingListProgress(valid, [matched.id])
  const variants = [
    ['one cent below the selected physical total',
      { lineTotalCents: matched.lineTotalCents - 1 }],
    ['one cent above the selected physical total',
      { lineTotalCents: matched.lineTotalCents + 1 }],
    ['zero total for a paid product', { lineTotalCents: 0 }],
    ['positive pack price changed without updating line total',
      { pricePerPackCents: matched.pricePerPackCents + 1 }],
    ['more packs without updating line total', { packs: matched.packs + 1 }],
    ['free pack with paid line total',
      { pricePerPackCents: 0, lineTotalCents: 1 }],
    ['unrelated positive line total',
      { pricePerPackCents: 1, packs: 2, lineTotalCents: 3 }],
  ]
  for (const [name, patch] of variants) {
    await t.test(name, () => {
      const candidate = structuredClone(valid)
      Object.assign(candidate.lines[index], patch)
      const before = structuredClone(candidate)
      assert.equal(buildShoppingListCopyText(candidate), null)
      expectFailClosed(candidate, originalRaw)
      assert.deepEqual(candidate, before, 'caller-owned data must be untouched')
    })
  }
  assert.deepEqual(restoreShoppingListProgress(valid, originalRaw), [matched.id])
})

test('shopping-v1 rejects arithmetic overflow before creating a persisted check key', () => {
  const value = basket()
  const index = matchedIndexOf(value)
  const saved = serializeShoppingListProgress(value, [value.lines[index].id])
  const invalid = structuredClone(value)
  Object.assign(invalid.lines[index], {
    packs: 2, pricePerPackCents: Number.MAX_SAFE_INTEGER,
    lineTotalCents: Number.MAX_SAFE_INTEGER,
  })
  expectFailClosed(invalid, saved)
})

test('shopping-v1 preserves legitimate coherent price changes and zero-price packs', () => {
  const original = basket()
  const index = matchedIndexOf(original)
  const id = original.lines[index].id
  const originalKey = shoppingListBasketKey(original)
  const originalRaw = serializeShoppingListProgress(original, [id, id, 'foreign-id'])
  assert.equal(JSON.parse(originalRaw).basketKey, originalKey)
  assert.deepEqual(restoreShoppingListProgress(original, originalRaw), [id])

  const repriced = structuredClone(original)
  repriced.lines[index].pricePerPackCents += 1
  repriced.lines[index].lineTotalCents =
    repriced.lines[index].packs * repriced.lines[index].pricePerPackCents
  assert.notEqual(shoppingListBasketKey(repriced), originalKey)
  assert.deepEqual(restoreShoppingListProgress(repriced, originalRaw), [])
  assert.deepEqual(restoreShoppingListProgress(
    repriced, serializeShoppingListProgress(repriced, [id]),
  ), [id])

  const free = structuredClone(original)
  free.lines[index].pricePerPackCents = 0
  free.lines[index].lineTotalCents = 0
  assert.deepEqual(restoreShoppingListProgress(
    free, serializeShoppingListProgress(free, [id]),
  ), [id])
})

test('shopping-v1 still round-trips every subset of up to seven valid line checks', () => {
  const value = basket()
  const ids = value.lines.slice(0, 7).map(line => line.id)
  for (let mask = 0; mask < 2 ** ids.length; mask++) {
    const selected = ids.filter((_, index) => (mask & (1 << index)) !== 0)
    const stored = serializeShoppingListProgress(value, [...selected, ...selected, 'foreign'])
    assert.deepEqual(restoreShoppingListProgress(value, stored), selected)
  }
})
