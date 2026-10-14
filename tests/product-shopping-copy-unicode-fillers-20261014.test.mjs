import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

test('portable list refuses blank-looking Unicode Letters and Symbols in store and item labels', async t => {
  const base = basket()
  assert.match(buildShoppingListCopyText(base), /Boodschappenlijst/u)
  const matchedIndex = base.lines.findIndex(line => line.status === 'matched')
  assert.ok(matchedIndex >= 0)
  const blankCodePoints = [
    ['Hangul choseong filler', '\u115f'],
    ['Hangul jungseong filler', '\u1160'],
    ['Hangul compatibility filler', '\u3164'],
    ['halfwidth Hangul filler', '\uffa0'],
    ['Braille pattern blank', '\u2800'],
  ]
  for (const [label, filler] of blankCodePoints) {
    for (const field of ['store.name', 'store.id', 'ingredientLabel', 'productName', 'line.id']) {
      await t.test(label + ' as ' + field, () => {
        const value = structuredClone(base)
        if (field === 'store.name') value.store.name = filler
        if (field === 'store.id') value.store.id = filler
        if (field === 'ingredientLabel') value.lines[matchedIndex].ingredientLabel = filler
        if (field === 'productName') value.lines[matchedIndex].productName = filler
        if (field === 'line.id') value.lines[matchedIndex].id = filler
        const before = structuredClone(value)
        assert.equal(buildShoppingListCopyText(value), null)
        assert.deepEqual(value, before, 'source must remain untouched')
      })
    }
  }
})

test('visible grocery text with combining marks, emoji selectors and fillers stays readable', () => {
  const value = basket()
  const index = value.lines.findIndex(line => line.status === 'matched')
  assert.ok(index >= 0)
  const id = value.lines[index].id
  value.store.name = 'PLUS \u115fmarkt'
  value.lines[index].ingredientLabel = 'Cafe\u0301\u2800bonen'
  value.lines[index].productName = 'Rijst\u3164\ufe0f verpakking'
  const before = structuredClone(value)
  const text = buildShoppingListCopyText(value, [id])
  assert.equal(typeof text, 'string')
  assert.match(text, /Boodschappenlijst — PLUS markt/u)
  assert.match(text, /Cafe\u0301 bonen/u)
  assert.match(text, /Rijst verpakking/u)
  assert.match(text, /\[x\] Rijst verpakking/u)
  assert.doesNotMatch(text, /[\u115f\u1160\u3164\uffa0\u2800]/u)
  assert.deepEqual(value, before)
})

test('old mark-only and selector-only labels remain rejected without altering prices', () => {
  for (const invisible of ['\u0301', '\u0650', '\ufe0f']) {
    const value = basket()
    value.store.name = invisible
    assert.equal(buildShoppingListCopyText(value), null)
  }
  const value = basket()
  const original = buildShoppingListCopyText(value)
  assert.equal(typeof original, 'string')
  const index = value.lines.findIndex(line => line.status === 'matched')
  assert.ok(index >= 0)
  value.lines[index].pricePerPackCents += 1
  value.lines[index].lineTotalCents =
    value.lines[index].packs * value.lines[index].pricePerPackCents
  assert.equal(buildShoppingListCopyText(value), original)
})
