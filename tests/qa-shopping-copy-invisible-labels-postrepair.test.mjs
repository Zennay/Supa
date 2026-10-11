import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2Store, m2InitialPlan, m2Recipes, m2Products, m2DefaultActiveDays,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function basket(activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays, products: m2Products,
  })
}

function storeNamed(name) {
  const current = basket()
  return { ...current, store: { ...current.store, name } }
}

function firstLineLabeled(label, field = 'ingredientLabel') {
  const current = basket()
  return {
    ...current,
    lines: current.lines.map((line, index) =>
      index === 0 ? { ...line, [field]: label } : line),
  }
}

test('postrepair: isolated Unicode formatting/combining codepoints abstain', () => {
  for (const mark of ['\u034F', '\u0650', '\u09BE', '\uFE0E', '\uFE0F', '\u180E', '\u00AD', '\u200D']) {
    assert.equal(buildShoppingListCopyText(storeNamed(mark)), null,
      'invisible store identity must abstain: ' + mark.codePointAt(0).toString(16))
  }
})

test('postrepair: combining-only ingredient and matched product names abstain', () => {
  for (const label of ['\u0301', '\u0650', '\uFE0F', ' \u034F\uFE0F ']) {
    assert.equal(buildShoppingListCopyText(firstLineLabeled(label)), null)
  }
  const current = basket()
  const matched = current.lines.find(line => line.status === 'matched')
  assert.ok(matched)
  const invalid = {
    ...current,
    lines: current.lines.map(line => line.id === matched.id
      ? { ...line, productName: '\u0301\uFE0F' } : line),
  }
  assert.equal(buildShoppingListCopyText(invalid), null)
})

test('postrepair: Unicode letters with meaningful vowel marks remain fully visible', () => {
  const original = basket()
  const before = JSON.stringify(original)
  const changed = {
    ...original,
    store: { ...original.store, name: 'Cafe\u0301 🛒\uFE0F' },
    lines: original.lines.map((line, index) =>
      index === 0 ? { ...line, productName: 'بِسم' } : line),
  }
  const copied = buildShoppingListCopyText(changed)
  assert.ok(copied)
  assert.match(copied, /Cafe\u0301 🛒/)
  assert.match(copied, /بِسم/)
  assert.doesNotMatch(copied, /€|besparing|prijsverschil/i)
  assert.equal(JSON.stringify(original), before)
})

test('postrepair: a real symbol or digit is a visible store identity', () => {
  assert.ok(buildShoppingListCopyText(storeNamed('🛒\uFE0F Supermarkt')))
  assert.ok(buildShoppingListCopyText(storeNamed('Winkel 123')))
})

test('postrepair: checked and empty-week copy remains safe', () => {
  const current = basket()
  const copy = buildShoppingListCopyText(current, ['chicken-thigh'])
  assert.ok(copy)
  assert.match(copy, /\[x\]/)
  assert.match(copy, /product zelf kiezen/)
  assert.doesNotMatch(copy, /€|besparing|prijsverschil/i)
  const empty = buildShoppingListCopyText(basket([]))
  assert.ok(empty)
  assert.match(empty, /nog geen boodschappen gepland/)
})
