import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  calculateDecimalPackCount,
  sumDecimalAmounts,
  sumDecimalDemandUnits,
} from '../src/domain/decimalPackArithmetic.ts'

// Product #1402: an unrepresentable sub-ULP ingredient cannot disappear into
// an otherwise representable physical demand. All fixtures are synthetic.
// They are NOT the real PLUS/DekaMarkt observed-week evidence required by #78.
const DUST = Number.MIN_VALUE
const stores = Object.freeze([
  Object.freeze({ id: 'fixture-a', name: 'Voorbeeldwinkel A' }),
  Object.freeze({ id: 'fixture-b', name: 'Voorbeeldwinkel B' }),
])
const plan = Object.freeze([{ day: 'Ma', recipeId: 'rice-week' }])
const activeDays = Object.freeze(['Ma'])

function recipesFor(entries) {
  return [{
    id: 'rice-week', title: 'Synthetische rijst', minutes: 10,
    servings: 1, estimatedCost: 0, tags: [],
    ingredients: entries.map(({ amount, unit }) => Object.freeze({
      id: 'rice', label: 'Basmati rijst', query: 'basmati rijst',
      amount, unit,
    })),
  }]
}

function basket(store, entries, packAmount = 100) {
  return buildOneStoreBasket({
    store, plan, activeDays, recipes: recipesFor(entries),
    products: [{
      id: store.id + '-rice', storeId: store.id, name: 'Basmati rijst',
      packAmount, packUnit: 'g', available: true, priceCents: 249,
    }],
  })
}

test('a representability-losing residue never disappears from a mass demand', () => {
  const mass = Object.freeze([
    Object.freeze({ amount: 0.1, unit: 'kg' }),
    Object.freeze({ amount: DUST, unit: 'g' }),
  ])
  assert.equal(sumDecimalDemandUnits(mass, 'kg'), null)
  assert.equal(sumDecimalDemandUnits(mass, 'g'), null)
  assert.equal(sumDecimalDemandUnits([...mass].reverse(), 'kg'), null)
  assert.equal(sumDecimalAmounts([100, DUST]), null)
  assert.equal(sumDecimalAmounts([DUST, 100]), null)
  assert.equal(
    calculateDecimalPackCount(mass, { amount: 100, unit: 'g' }), 2,
    'exactly 100g plus positive dust needs two whole 100g packs',
  )
  assert.equal(
    calculateDecimalPackCount(mass, { amount: 50, unit: 'g', count: 2 }), 2,
    'a 2×50g multipack still requires two purchases',
  )
  assert.equal(mass[1].amount, DUST)
})

test('volume conversion also refuses to round away a positive tiny residue', () => {
  const volume = Object.freeze([
    Object.freeze({ amount: 0.1, unit: 'l' }),
    Object.freeze({ amount: DUST, unit: 'ml' }),
  ])
  assert.equal(sumDecimalDemandUnits(volume, 'l'), null)
  assert.equal(sumDecimalDemandUnits(volume, 'ml'), null)
  assert.equal(calculateDecimalPackCount(volume, { amount: 100, unit: 'ml' }), 2)
  assert.equal(calculateDecimalPackCount(volume, { amount: 0.1, unit: 'l' }), 2)
})

test('M2 ingredient reuse leaves unrepresentable mass unresolved, not priced', () => {
  for (const entries of [
    [{ amount: 0.1, unit: 'kg' }, { amount: DUST, unit: 'g' }],
    [{ amount: DUST, unit: 'g' }, { amount: 0.1, unit: 'kg' }],
  ]) {
    const aggregated = aggregatePlanIngredients(plan, recipesFor(entries), activeDays)
    assert.equal(aggregated.length, 1)
    assert.equal(aggregated[0].amount, null)

    const baseline = basket(stores[0], entries)
    const candidate = basket(stores[1], entries)
    for (const side of [baseline, candidate]) {
      assert.equal(side.lines.length, 1)
      assert.equal(side.lines[0].status, 'unresolved')
      assert.equal(side.lines[0].requirement.amount, null)
      assert.equal(side.unresolvedLineCount, 1)
      assert.equal(side.matchedLineCount, 0)
      assert.equal(side.totalCents, 0)
    }
    const comparison = compareFullBaskets({ baseline, candidate })
    assert.equal(comparison.claimable, false)
    assert.equal(comparison.outcome, 'unknown')
    assert.equal(comparison.deltaCents, null)
    assert.equal(comparison.savingsCents, null)
    assert.deepEqual(comparison.lineDeltas, [])
  }
})

test('ordinary exact decimal increments remain purchasable at true pack edge', () => {
  const entries = [
    { amount: 0.1, unit: 'kg' },
    { amount: 0.001, unit: 'kg' },
  ]
  assert.equal(sumDecimalDemandUnits(entries, 'g'), 101)
  assert.equal(sumDecimalDemandUnits(entries, 'kg'), 0.101)
  assert.equal(calculateDecimalPackCount(entries, { amount: 100, unit: 'g' }), 2)
  const baseline = basket(stores[0], entries, 101)
  const candidate = basket(stores[1], entries, 100)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  assert.equal(baseline.lines[0].packs, 1)
  assert.equal(candidate.lines[0].packs, 2)
  assert.equal(baseline.totalCents, 249)
  assert.equal(candidate.totalCents, 498)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'worse')
  assert.equal(comparison.deltaCents, 249)
  assert.equal(comparison.savingsCents, -249)
})
