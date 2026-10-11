import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function observedFixture(storeId, demand, pack, priceCents) {
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: [{ day: 'Ma', recipeId: 'controlled' }],
    activeDays: ['Ma'],
    recipes: [{
      id: 'controlled', title: 'Gecontroleerde maaltijd',
      minutes: 15, servings: 1, tags: [], estimatedCost: 1.99,
      ingredients: [{
        id: 'ingredient-1', label: 'Kippendij', query: 'kippendij',
        amount: demand.amount, unit: demand.unit,
      }],
    }],
    products: [{
      id: storeId + '-p1', storeId, name: 'Kippendij',
      packAmount: pack.amount, packUnit: pack.unit,
      packCount: pack.count ?? 1, available: true, priceCents,
    }],
  })
}

function pair(demand, pack, candidatePrice = 199) {
  const baseline = observedFixture('controlled-plus', demand, pack, 199)
  const candidate = observedFixture('controlled-dekamarkt', demand, pack, candidatePrice)
  for (const basket of [baseline, candidate]) {
    assert.equal(basket.matchedLineCount, 1, 'canonical basket builder must match')
    assert.equal(basket.unresolvedLineCount, 0)
  }
  return { baseline, candidate }
}

test('postrepair: exact 0.07g/0.01g packs preserve honest price delta and caller data', () => {
  const baskets = pair({ amount: 0.07, unit: 'g' }, { amount: 0.01, unit: 'g' }, 200)
  assert.equal(baskets.baseline.lines[0].packs, 7)
  const before = JSON.stringify(baskets)
  const result = compareFullBaskets(baskets)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, 7)
  assert.equal(result.savingsCents, -7)
  assert.equal(result.lineDeltas.length, 1)
  assert.equal(result.lineDeltas[0].deltaCents, 7)
  assert.equal(JSON.stringify(baskets), before)
})

test('postrepair: exact converted 0.00007kg / 0.01g is one decimal identity', () => {
  const baskets = pair({ amount: 0.00007, unit: 'kg' }, { amount: 0.01, unit: 'g' })
  assert.equal(baskets.baseline.lines[0].packs, 7)
  assert.equal(compareFullBaskets(baskets).outcome, 'same')
  assert.equal(compareFullBaskets(baskets).claimable, true)
})

test('postrepair: 3×0.15g true multipack covers exactly 0.45g', () => {
  const baskets = pair({ amount: 0.45, unit: 'g' }, { amount: 0.15, unit: 'g', count: 3 })
  assert.equal(baskets.baseline.lines[0].packs, 1)
  assert.equal(compareFullBaskets(baskets).claimable, true)
  assert.equal(compareFullBaskets(baskets).savingsCents, 0)
})

test('postrepair: true tiny decimal overshoot is never rounded back to seven packs', () => {
  const baskets = pair(
    { amount: 0.07000000000000002, unit: 'g' }, { amount: 0.01, unit: 'g' },
  )
  assert.equal(baskets.baseline.lines[0].packs, 8)
  assert.equal(compareFullBaskets(baskets).claimable, true)
  const spoofed = {
    ...baskets.baseline,
    lines: baskets.baseline.lines.map(line => ({
      ...line, packs: 7, lineTotalCents: 7 * line.pricePerPackCents,
    })),
    totalCents: 7 * baskets.baseline.lines[0].pricePerPackCents,
  }
  const result = compareFullBaskets({ baseline: spoofed, candidate: baskets.candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
})

test('postrepair: demand mismatch remains unknown even when both basket totals reconcile', () => {
  const baskets = pair({ amount: 0.07, unit: 'g' }, { amount: 0.01, unit: 'g' })
  const candidate = {
    ...baskets.candidate,
    lines: baskets.candidate.lines.map(line => ({
      ...line, requirement: { ...line.requirement, amount: 0.069 },
    })),
  }
  const result = compareFullBaskets({ baseline: baskets.baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), /demand differs/)
})

test('postrepair: cross-family units cannot create an accidental comparable basket', () => {
  const baskets = pair({ amount: 0.07, unit: 'g' }, { amount: 0.01, unit: 'g' })
  const candidate = {
    ...baskets.candidate,
    lines: baskets.candidate.lines.map(line => ({
      ...line, pack: { ...line.pack, unit: 'ml' },
    })),
  }
  const result = compareFullBaskets({ baseline: baskets.baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
})
