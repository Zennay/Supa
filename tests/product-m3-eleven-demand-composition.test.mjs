import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2InitialPlan, m2Recipes, m2DefaultActiveDays, m2Products,
} from '../src/data/m2Fixture.ts'

function storeBasket(storeId, priceIncrement = 0, withGaram = true) {
  const products = m2Products.map(product => ({
    ...product,
    id: storeId + '-' + product.id,
    storeId,
    priceCents: product.priceCents + priceIncrement,
  }))
  if (withGaram) products.push({
    id: storeId + '-garam',
    storeId,
    name: 'Garam masala 50 g',
    packAmount: 50,
    packUnit: 'g',
    available: true,
    priceCents: 139 + priceIncrement,
  })
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function fullPair(candidateIncrease = 0) {
  const baseline = storeBasket('controlled-plus')
  const candidate = storeBasket('controlled-dekamarkt', candidateIncrease)
  for (const basket of [baseline, candidate]) {
    assert.equal(basket.selectedMealCount, 4)
    assert.equal(basket.lines.length, 11)
    assert.equal(basket.matchedLineCount, 11)
    assert.equal(basket.unresolvedLineCount, 0)
    assert.equal(basket.totalCents,
      basket.lines.reduce((sum, line) => sum + line.lineTotalCents, 0))
  }
  return { baseline, candidate }
}

function assertUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('canonical 11-demand M3 basket comparison remains a deterministic synthetic same outcome', () => {
  const { baseline, candidate } = fullPair()
  const original = JSON.stringify({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.deepEqual(result.reasons, [])
  assert.equal(JSON.stringify({ baseline, candidate }), original)
})

test('canonical 11-demand price-only change produces cent-exact weighted pack delta', () => {
  const { baseline, candidate } = fullPair(1)
  const expectedDelta = baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  assert.ok(expectedDelta >= 11)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expectedDelta)
  assert.equal(result.savingsCents, -expectedDelta)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(result.lineDeltas.reduce((sum, line) => sum + line.deltaCents, 0), expectedDelta)
})

test('canonical 11-demand sparse basket snapshot cannot inherit trusted price claims', () => {
  const { baseline, candidate } = fullPair()
  const missing = baseline.lines.slice()
  missing.length = 12
  assert.equal(Object.hasOwn(missing, 11), false)
  assertUnknown(compareFullBaskets({
    baseline: { ...baseline, lines: missing }, candidate,
  }))
})

test('canonical 11-demand one-store unresolved ingredient makes M3 comparison unknown', () => {
  const baseline = storeBasket('controlled-plus')
  const candidate = storeBasket('controlled-dekamarkt', 0, false)
  assert.equal(candidate.lines.length, 11)
  assert.ok(candidate.unresolvedLineCount >= 1)
  assertUnknown(compareFullBaskets({ baseline, candidate }))
})
