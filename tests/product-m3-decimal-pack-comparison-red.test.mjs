import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function build(storeId, demand, pack, priceCents = 199) {
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: [{ day: 'Ma', recipeId: 'decimal-kip' }],
    activeDays: ['Ma'],
    recipes: [{
      id: 'decimal-kip', title: 'Gecontroleerd recept', minutes: 10,
      servings: 1, estimatedCost: 1.99, tags: [],
      ingredients: [{
        id: 'chicken-thigh', label: 'Kippendij',
        query: 'kippendij', amount: demand.amount, unit: demand.unit,
      }],
    }],
    products: [{
      id: storeId + '-chicken', storeId, name: 'Kippendij',
      packAmount: pack.amount, packUnit: pack.unit,
      packCount: pack.count ?? 1, available: true, priceCents,
    }],
  })
}

function pair(demand, pack, priceCandidate = 199) {
  const baseline = build('plus-controlled', demand, pack, 199)
  const candidate = build('dekamarkt-controlled', demand, pack, priceCandidate)
  for (const basket of [baseline, candidate]) {
    assert.equal(basket.selectedMealCount, 1)
    assert.equal(basket.lines.length, 1)
    assert.equal(basket.matchedLineCount, 1,
      'the actual #273 basket builder must resolve the one product')
    assert.equal(basket.unresolvedLineCount, 0)
  }
  return { baseline, candidate }
}

test('M3 comparator accepts seven exactly sufficient 0.01 g packs from the real decimal basket [RED]', () => {
  const { baseline, candidate } = pair({ amount: 0.07, unit: 'g' }, { amount: 0.01, unit: 'g' })
  assert.equal(baseline.lines[0].packs, 7)
  assert.equal(candidate.lines[0].packs, 7)
  assert.equal(baseline.totalCents, 1393)
  const before = JSON.stringify({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 1)
  assert.equal(JSON.stringify({ baseline, candidate }), before)
})

test('M3 comparator accepts a legitimate three-unit decimal multipack, not two purchased packs [RED]', () => {
  const { baseline, candidate } = pair(
    { amount: 0.45, unit: 'g' }, { amount: 0.15, unit: 'g', count: 3 }, 200,
  )
  assert.equal(baseline.lines[0].packs, 1)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, 1)
  assert.equal(result.savingsCents, -1)
})

test('M3 comparator preserves honest kg/g and l/ml cross-unit decimal boundaries [RED]', () => {
  const cases = [
    [{ amount: 0.00007, unit: 'kg' }, { amount: 0.01, unit: 'g' }, 7],
    [{ amount: 0.00007, unit: 'l' }, { amount: 0.01, unit: 'ml' }, 7],
  ]
  for (const [demand, pack, expectedPacks] of cases) {
    const { baseline, candidate } = pair(demand, pack)
    assert.equal(baseline.lines[0].packs, expectedPacks)
    const result = compareFullBaskets({ baseline, candidate })
    assert.equal(result.claimable, true, JSON.stringify({ demand, pack, result }))
    assert.equal(result.deltaCents, 0)
  }
})

test('an actual decimal overshoot still requires an extra physical pack [control]', () => {
  const { baseline, candidate } = pair(
    { amount: 0.07000000000000002, unit: 'g' },
    { amount: 0.01, unit: 'g' },
  )
  assert.equal(baseline.lines[0].packs, 8)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
})

test('one-store empty weeks never create an M3 financial claim [control]', () => {
  const { baseline, candidate } = pair({ amount: 0.1, unit: 'g' }, { amount: 0.1, unit: 'g' })
  for (const basket of [baseline, candidate]) {
    basket.lines = []
    basket.selectedMealCount = 0
    basket.totalCents = 0
    basket.matchedLineCount = 0
  }
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
})
