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

function withChicken(current, demand, pack, packs) {
  const previous = current.lines.find(line => line.id === 'chicken-thigh')
  assert.ok(previous)
  assert.equal(previous.status, 'matched')
  const newer = {
    ...previous,
    requirement: demand,
    pack: { amount: pack.amount, unit: pack.unit, count: 1 },
    packs,
    lineTotalCents: packs * previous.pricePerPackCents,
  }
  return {
    ...current,
    totalCents: current.totalCents - previous.lineTotalCents + newer.lineTotalCents,
    lines: current.lines.map(line => line.id === previous.id ? newer : line),
  }
}

test('a precise 0.07 g demand is exactly seven 0.01 g packs [RED]', () => {
  const current = basket()
  const decimal = withChicken(current, { amount: 0.07, unit: 'g' }, { amount: 0.01, unit: 'g' }, 7)
  const copied = buildShoppingListCopyText(decimal)
  assert.ok(copied, 'decimal quotient 0.07 / 0.01 must not round up to eight packs')
  assert.match(copied, /7 × 0,01 g \(nodig: 0,07 g\)/)
})

test('a precise 0.45 g demand is exactly three 0.15 g packs [RED]', () => {
  const current = basket()
  const decimal = withChicken(current, { amount: 0.45, unit: 'g' }, { amount: 0.15, unit: 'g' }, 3)
  const copied = buildShoppingListCopyText(decimal)
  assert.ok(copied, 'multiplication 3 × 0.15 must not be treated as less than 0.45')
  assert.match(copied, /3 × 0,15 g \(nodig: 0,45 g\)/)
})

test('decimal volume has the same exact boundary semantics [RED]', () => {
  const current = basket()
  const decimal = withChicken(current, { amount: 0.07, unit: 'ml' }, { amount: 0.01, unit: 'ml' }, 7)
  const copied = buildShoppingListCopyText(decimal)
  assert.ok(copied)
  assert.match(copied, /7 × 0,01 ml \(nodig: 0,07 ml\)/)
})

test('insufficient decimal quantities must still fail closed [control]', () => {
  const current = basket()
  const insufficient = withChicken(current, { amount: 0.451, unit: 'g' }, { amount: 0.15, unit: 'g' }, 3)
  assert.equal(buildShoppingListCopyText(insufficient), null)
  const excess = withChicken(current, { amount: 0.45, unit: 'g' }, { amount: 0.15, unit: 'g' }, 4)
  assert.equal(buildShoppingListCopyText(excess), null)
})

test('unchanged normal copy remains valid without price/savings text [control]', () => {
  const current = basket()
  const before = JSON.stringify(current)
  const copied = buildShoppingListCopyText(current, ['chicken-thigh'])
  assert.ok(copied)
  assert.match(copied, /\[x\]/)
  assert.doesNotMatch(copied, /€|besparing|prijsverschil/i)
  assert.equal(JSON.stringify(current), before)
})
