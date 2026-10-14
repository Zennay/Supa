import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

// #1402: partial baskets must remain partial even when an independent
// correctly priced ingredient differs between two synthetic shops.
// These fixtures are not field observations and cannot close M3 #78.
const stores = [
  { id: 'fixture-a', name: 'Fictieve winkel A' },
  { id: 'fixture-b', name: 'Fictieve winkel B' },
]
const plan = [{ day: 'Ma', recipeId: 'week' }]
const activeDays = ['Ma']

function getBasket(store, tomatoPriceCents, tinyRiceResidue) {
  const ingredients = [
    { id: 'rice', label: 'Basmati rijst', query: 'basmati rijst', amount: 0.1, unit: 'kg' },
    { id: 'tomato', label: 'Tomatenblokjes', query: 'tomatenblokjes', amount: 400, unit: 'g' },
  ]
  if (tinyRiceResidue) {
    ingredients.push({
      id: 'rice', label: 'Basmati rijst', query: 'basmati rijst',
      amount: Number.MIN_VALUE, unit: 'g',
    })
  }
  return buildOneStoreBasket({
    store, plan, activeDays,
    recipes: [{
      id: 'week', title: 'Fictieve maaltijd', minutes: 10,
      servings: 1, estimatedCost: 0, tags: [], ingredients,
    }],
    products: [
      {
        id: store.id + '-rice', storeId: store.id, name: 'Basmati rijst',
        packAmount: 100, packUnit: 'g', available: true, priceCents: 249,
      },
      {
        id: store.id + '-tomato', storeId: store.id, name: 'Tomatenblokjes',
        packAmount: 400, packUnit: 'g', available: true,
        priceCents: tomatoPriceCents,
      },
    ],
  })
}

test('one unrepresentable ingredient prevents a misleading full-basket bargain', () => {
  const baseline = getBasket(stores[0], 149, true)
  const candidate = getBasket(stores[1], 99, true)
  for (const side of [baseline, candidate]) {
    assert.equal(side.lines.length, 2)
    assert.equal(side.matchedLineCount, 1)
    assert.equal(side.unresolvedLineCount, 1)
    const rice = side.lines.find(line => line.id === 'rice')
    const tomato = side.lines.find(line => line.id === 'tomato')
    assert.equal(rice.status, 'unresolved')
    assert.equal(rice.requirement.amount, null)
    assert.equal(tomato.status, 'matched')
    assert.equal(tomato.packs, 1)
  }
  assert.equal(baseline.totalCents, 149, 'known part is not a total grocery quote')
  assert.equal(candidate.totalCents, 99)

  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
})

test('without a precision gap, all matched items retain exact cent comparison', () => {
  const baseline = getBasket(stores[0], 149, false)
  const candidate = getBasket(stores[1], 99, false)
  assert.equal(baseline.matchedLineCount, 2)
  assert.equal(candidate.matchedLineCount, 2)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  assert.equal(baseline.totalCents, 398)
  assert.equal(candidate.totalCents, 348)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'better')
  assert.equal(result.deltaCents, -50)
  assert.equal(result.savingsCents, 50)
  assert.equal(result.lineDeltas.length, 2)
  assert.deepEqual([...result.lineDeltas.map(line => line.deltaCents)].sort((a, b) => a - b), [-50, 0])
})
