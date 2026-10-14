import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

// All retailers, prices and quantities here are deliberate synthetic fixtures.
// Never use this as the genuine observed PLUS+DekaMarkt M3 field pair (#78).
const baselineStore = Object.freeze({ id: 'fixture-a', name: 'Voorbeeldwinkel A' })
const candidateStore = Object.freeze({ id: 'fixture-b', name: 'Voorbeeldwinkel B' })
const recipes = [{
  id: 'rice-week',
  title: 'Rijst met groente (demovoorbeeld)',
  minutes: 10,
  servings: 1,
  estimatedCost: 0,
  tags: [],
  ingredients: Array.from({ length: 1_000 }, (_, i) => ({
    id: 'rice', label: 'Basmati rijst', query: 'basmati rijst',
    amount: i % 2 === 0 ? 0.1 : 0.0001,
    unit: i % 2 === 0 ? 'g' : 'kg',
  })),
}]
const plan = [{ day: 'Ma', recipeId: 'rice-week' }]
const activeDays = ['Ma']

function forStore(store, packAmount, priceCents) {
  return buildOneStoreBasket({
    store, plan, recipes, activeDays,
    products: packAmount === null ? [] : [{
      id: store.id + '-rice',
      storeId: store.id,
      name: 'Basmati rijst',
      packAmount,
      packUnit: 'g',
      available: true,
      priceCents,
    }],
  })
}

test('many reused mixed-unit demands compare honestly when candidate is worse', () => {
  const baseline = forStore(baselineStore, 100, 249)
  const candidate = forStore(candidateStore, 100, 259)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(baseline.lines.length, 1)
  assert.equal(candidate.lines.length, 1)
  assert.equal(baseline.lines[0].requirement.amount, 100)
  assert.equal(candidate.lines[0].requirement.amount, 100)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, 10)
  assert.equal(result.savingsCents, -10)
  assert.deepEqual(result.lineDeltas.map(line => line.deltaCents), [10])
})

test('lower unit price can produce better synthetic basket without claiming live prices', () => {
  const baseline = forStore(baselineStore, 100, 249)
  const candidate = forStore(candidateStore, 100, 199)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'better')
  assert.equal(result.deltaCents, -50)
  assert.equal(result.savingsCents, 50)
  assert.deepEqual(result.lineDeltas.map(line => line.deltaCents), [-50])
})

test('a 99.99g candidate pack correctly prices two units of 100g demand', () => {
  const baseline = forStore(baselineStore, 100, 249)
  const candidate = forStore(candidateStore, 99.99, 199)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(candidate.lines[0].packs, 2)
  assert.equal(candidate.totalCents, 398)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, 149)
  assert.equal(result.savingsCents, -149)
})

test('missing candidate product cannot produce a synthetic comparison savings claim', () => {
  const baseline = forStore(baselineStore, 100, 249)
  const candidate = forStore(candidateStore, null, 0)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(candidate.unresolvedLineCount, 1)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
})
