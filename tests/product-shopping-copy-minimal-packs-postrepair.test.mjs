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

function withChicken(basketValue, options) {
  const line = basketValue.lines.find(item => item.id === 'chicken-thigh')
  assert.ok(line)
  assert.equal(line.status, 'matched')
  const newer = { ...line, ...options }
  return {
    ...basketValue,
    totalCents: basketValue.totalCents - line.lineTotalCents + newer.lineTotalCents,
    lines: basketValue.lines.map(item => item.id === line.id ? newer : item),
  }
}

test('postrepair: a valid converted kg demand and 400 g pack preserves exact two-pack copy', () => {
  const original = basket()
  const converted = withChicken(original, {
    requirement: { amount: 0.6, unit: 'kg' },
  })
  const text = buildShoppingListCopyText(converted)
  assert.ok(text)
  assert.match(text, /2 × 400 g \(nodig: 0,6 kg\)/)
  assert.match(buildShoppingListCopyText(converted, ['chicken-thigh']), /\[x\] /)
})

test('postrepair: a matched product cannot be copied with extra packs even after repricing', () => {
  const original = basket()
  const originalText = buildShoppingListCopyText(original)
  assert.ok(originalText)
  const line = original.lines.find(item => item.id === 'chicken-thigh')
  assert.ok(line)
  const fake = withChicken(original, {
    packs: 4,
    pricePerPackCents: line.pricePerPackCents + 1,
    lineTotalCents: 4 * (line.pricePerPackCents + 1),
  })
  assert.equal(buildShoppingListCopyText(fake), null)
  assert.equal(buildShoppingListCopyText(original), originalText)
})

test('postrepair: a real 3-pack demand remains copyable but four packs are refused', () => {
  const original = basket()
  const line = original.lines.find(item => item.id === 'chicken-thigh')
  assert.ok(line)
  const enough = withChicken(original, {
    requirement: { amount: 1100, unit: 'g' },
    packs: 3,
    lineTotalCents: 3 * line.pricePerPackCents,
  })
  assert.match(buildShoppingListCopyText(enough), /3 × 400 g \(nodig: 1100 g\)/)
  const excessive = withChicken(original, {
    requirement: { amount: 1100, unit: 'g' },
    packs: 4,
    lineTotalCents: 4 * line.pricePerPackCents,
  })
  assert.equal(buildShoppingListCopyText(excessive), null)
})

test('postrepair: correct multipack counts are allowed, inflated counts refused', () => {
  const original = basket()
  const line = original.lines.find(item => item.id === 'chicken-thigh')
  assert.ok(line)
  const correct = withChicken(original, {
    pack: { amount: 0.4, unit: 'kg', count: 2 },
    packs: 1,
    lineTotalCents: line.pricePerPackCents,
  })
  assert.match(buildShoppingListCopyText(correct), /1 × 2 × 0,4 kg \(nodig: 600 g\)/)
  const excessive = withChicken(original, {
    pack: { amount: 0.4, unit: 'kg', count: 2 },
  })
  assert.equal(buildShoppingListCopyText(excessive), null)
})

test('postrepair: safe complete, unresolved and empty weeks still do not claim prices', () => {
  const original = basket()
  const standard = buildShoppingListCopyText(original)
  assert.ok(standard)
  assert.match(standard, /product zelf kiezen/)
  assert.doesNotMatch(standard, /€|besparing|prijsverschil/i)

  const empty = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes, activeDays: [],
    products: m2Products,
  })
  const emptyText = buildShoppingListCopyText(empty)
  assert.ok(emptyText)
  assert.match(emptyText, /nog geen boodschappen gepland/)
  assert.doesNotMatch(emptyText, /\[ \]|€/)
})
