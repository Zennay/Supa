import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2InitialPlan, m2Recipes, m2DefaultActiveDays, m2Products } from '../src/data/m2Fixture.ts'

// All amounts below are synthetic. No observed PLUS/DekaMarkt prices or M3 evidence.
function basket(storeId, increment = 0) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
    priceCents: product.priceCents + increment,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true,
    priceCents: 139 + increment,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  assert.equal(result.unresolvedLineCount, 0)
  return result
}

function pair(increment = 0) {
  return { baseline: basket('controlled-plus'), candidate: basket('controlled-dekamarkt', increment) }
}

function matched(basketValue, ingredientId) {
  const line = basketValue.lines.find(line => line.id === ingredientId)
  assert.ok(line && line.status === 'matched', ingredientId)
  return line
}

function unknown(comparison) {
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.deepEqual(comparison.lineDeltas, [])
}

test('M3 same 11-demand basket stays comparable when candidate expresses 450 g as 0.45 kg', () => {
  const input = pair()
  const rice = matched(input.candidate, 'basmati-rice')
  assert.deepEqual(rice.requirement, { amount: 450, unit: 'g' })
  rice.requirement = { amount: 0.45, unit: 'kg' }
  const before = structuredClone(input)
  const comparison = compareFullBaskets(input)
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'same')
  assert.equal(comparison.deltaCents, 0)
  assert.equal(comparison.lineDeltas.length, 11)
  assert.deepEqual(input, before)
})

test('M3 equal volume demand 400 ml / 0.4 l plus mass conversion retains cent-exact worse result', () => {
  const input = pair(1)
  const coconut = matched(input.candidate, 'coconut-milk')
  assert.equal(coconut.requirement.amount, 400)
  coconut.requirement = { amount: 0.4, unit: 'l' }
  matched(input.candidate, 'basmati-rice').requirement = { amount: 0.45, unit: 'kg' }
  const expected = input.baseline.lines.reduce((total, line) => total + line.packs, 0)
  const comparison = compareFullBaskets(input)
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'worse')
  assert.equal(comparison.deltaCents, expected)
  assert.equal(comparison.savingsCents, -expected)
  assert.equal(comparison.lineDeltas.length, 11)
})

test('M3 decimal requirement differs by a tiny real quantity: no epsilon-based claim', () => {
  const input = pair()
  matched(input.candidate, 'basmati-rice').requirement = {
    amount: 0.4500000000000001, unit: 'kg',
  }
  unknown(compareFullBaskets(input))
})

test('M3 unit-family disagreement must not become a trusted comparison', () => {
  const input = pair()
  matched(input.candidate, 'basmati-rice').requirement = { amount: 0.45, unit: 'l' }
  unknown(compareFullBaskets(input))
})

test('M3 unchanged 11-demand reference baskets still compare exactly', () => {
  const input = pair()
  const comparison = compareFullBaskets(input)
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'same')
  assert.equal(comparison.lineDeltas.length, 11)
})
