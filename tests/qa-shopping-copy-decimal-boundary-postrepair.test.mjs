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

function replaceChicken(current, required, pack, packs, count = 1) {
  const old = current.lines.find(line => line.id === 'chicken-thigh')
  assert.ok(old)
  const line = {
    ...old, requirement: required, pack: { ...pack, count }, packs,
    lineTotalCents: old.pricePerPackCents * packs,
  }
  return {
    ...current,
    totalCents: current.totalCents - old.lineTotalCents + line.lineTotalCents,
    lines: current.lines.map(row => row.id === old.id ? line : row),
  }
}

test('postrepair: 0.45 g across 3 decimal packs copies, 0.451 g does not', () => {
  const current = basket()
  const pack = { amount: 0.15, unit: 'g' }
  const exact = replaceChicken(current, { amount: 0.45, unit: 'g' }, pack, 3)
  const copied = buildShoppingListCopyText(exact)
  assert.ok(copied)
  assert.match(copied, /3 × 0,15 g \(nodig: 0,45 g\)/)
  const short = replaceChicken(current, { amount: 0.451, unit: 'g' }, pack, 3)
  assert.equal(buildShoppingListCopyText(short), null)
})

test('postrepair: no false ceil at seven decimal 0.01 g packs', () => {
  const current = basket()
  const pack = { amount: 0.01, unit: 'g' }
  assert.match(
    buildShoppingListCopyText(replaceChicken(current, { amount: 0.07, unit: 'g' }, pack, 7)),
    /7 × 0,01 g \(nodig: 0,07 g\)/,
  )
  assert.equal(
    buildShoppingListCopyText(replaceChicken(current, { amount: 0.07, unit: 'g' }, pack, 8)),
    null,
  )
})

test('postrepair: canonical kg-to-g decimal demand compares exactly', () => {
  const current = basket()
  const exact = replaceChicken(current,
    { amount: 0.00045, unit: 'kg' }, { amount: 0.15, unit: 'g' }, 3)
  assert.match(buildShoppingListCopyText(exact), /3 × 0,15 g \(nodig: 0,00045 kg\)/)
  const insufficient = replaceChicken(current,
    { amount: 0.000451, unit: 'kg' }, { amount: 0.15, unit: 'g' }, 3)
  assert.equal(buildShoppingListCopyText(insufficient), null)
})

test('postrepair: canonical liters-to-milliliters decimal demand compares exactly', () => {
  const current = basket()
  const exact = replaceChicken(current,
    { amount: 0.00007, unit: 'l' }, { amount: 0.01, unit: 'ml' }, 7)
  assert.match(buildShoppingListCopyText(exact), /7 × 0,01 ml \(nodig: 0,00007 l\)/)
  const inflated = replaceChicken(current,
    { amount: 0.00007, unit: 'l' }, { amount: 0.01, unit: 'ml' }, 8)
  assert.equal(buildShoppingListCopyText(inflated), null)
})

test('postrepair: one short representable decimal step is never swallowed by epsilon', () => {
  const current = basket()
  const after = replaceChicken(current,
    { amount: 0.45000000000000007, unit: 'g' }, { amount: 0.15, unit: 'g' }, 3)
  assert.equal(buildShoppingListCopyText(after), null)
})

test('postrepair: one purchased multipack of seven decimal units is minimal', () => {
  const current = basket()
  const exact = replaceChicken(current,
    { amount: 0.07, unit: 'g' }, { amount: 0.01, unit: 'g' }, 1, 7)
  assert.match(buildShoppingListCopyText(exact), /1 × 7 × 0,01 g \(nodig: 0,07 g\)/)
  assert.equal(buildShoppingListCopyText(replaceChicken(current,
    { amount: 0.07, unit: 'g' }, { amount: 0.01, unit: 'g' }, 2, 7)), null)
})

test('postrepair: normal checked/unresolved/empty copy remains trustworthy and immutable', () => {
  const current = basket()
  const before = JSON.stringify(current)
  const text = buildShoppingListCopyText(current, ['chicken-thigh'])
  assert.ok(text)
  assert.match(text, /\[x\]/)
  assert.match(text, /product zelf kiezen/)
  assert.doesNotMatch(text, /€|besparing|prijsverschil/i)
  assert.equal(JSON.stringify(current), before)

  const empty = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: [], products: m2Products,
  })
  assert.match(buildShoppingListCopyText(empty), /nog geen boodschappen gepland/)
})
