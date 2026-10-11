import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function currentBasket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

function alterChicken(basket, change) {
  const previous = basket.lines.find(line => line.id === 'chicken-thigh')
  assert.ok(previous)
  assert.equal(previous.status, 'matched')
  assert.equal(previous.requirement.amount, 600)
  assert.equal(previous.requirement.unit, 'g')
  assert.equal(previous.pack.amount, 400)
  assert.equal(previous.pack.unit, 'g')
  assert.equal(previous.packs, 2)
  const updated = change(previous)
  return {
    ...basket,
    lines: basket.lines.map(line => line.id === previous.id ? updated : line),
    totalCents: basket.totalCents - previous.lineTotalCents + updated.lineTotalCents,
  }
}

test('copied list refuses self-consistent but unnecessary extra physical packs [RED]', () => {
  const original = currentBasket()
  const before = JSON.stringify(original)
  const tooMany = alterChicken(original, line => ({
    ...line,
    packs: 3,
    lineTotalCents: 3 * line.pricePerPackCents,
  }))
  assert.equal(buildShoppingListCopyText(tooMany), null)
  assert.equal(JSON.stringify(original), before)
})

test('copied list refuses stale number of packs after changing multipack count [RED]', () => {
  const original = currentBasket()
  const staleMultipack = alterChicken(original, line => ({
    ...line,
    pack: { ...line.pack, count: 2 },
    // Still two purchased multipacks, although one now covers 600 g.
  }))
  assert.equal(buildShoppingListCopyText(staleMultipack), null)
})

test('valid exact pack minimum and true multipack keep portable shopping text', () => {
  const original = currentBasket()
  const initialText = buildShoppingListCopyText(original)
  assert.ok(initialText)
  assert.match(initialText, /2 × 400 g \(nodig: 600 g\)/)

  const validMultipack = alterChicken(original, line => ({
    ...line,
    pack: { ...line.pack, count: 2 },
    packs: 1,
    lineTotalCents: line.pricePerPackCents,
  }))
  const copied = buildShoppingListCopyText(validMultipack)
  assert.ok(copied)
  assert.match(copied, /1 × 2 × 400 g \(nodig: 600 g\)/)

  const trueThreePackDemand = alterChicken(original, line => ({
    ...line,
    requirement: { amount: 1100, unit: 'g' },
    packs: 3,
    lineTotalCents: 3 * line.pricePerPackCents,
  }))
  assert.match(buildShoppingListCopyText(trueThreePackDemand), /3 × 400 g \(nodig: 1100 g\)/)
})

test('legitimate precise boundary still uses minimum packs and never infers prices', () => {
  const original = currentBasket()
  const exact = alterChicken(original, line => ({
    ...line,
    requirement: { amount: 800, unit: 'g' },
  }))
  const text = buildShoppingListCopyText(exact)
  assert.ok(text)
  assert.match(text, /2 × 400 g \(nodig: 800 g\)/)
  assert.doesNotMatch(text, /€|besparing|korting|prijsverschil/i)
})
