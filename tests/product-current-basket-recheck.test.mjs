import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { compareCurrentBaskets } from '../src/domain/currentBasketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const baselineStore = { ...m2Store, id: 'baseline-controlled', name: 'Baseline controlled' }
const candidateStore = { ...m2Store, id: 'candidate-controlled', name: 'Candidate controlled' }

function controlledProducts(store, priceChange = 0) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + priceChange,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceChange,
    },
  ]
}

function basket(store, priceChange = 0, activeDays = m2DefaultActiveDays, products) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products: products ?? controlledProducts(store, priceChange),
  })
}

function pair(priceChange = -10) {
  return {
    baseline: basket(baselineStore),
    candidate: basket(candidateStore, priceChange),
  }
}

test('current full-basket comparison rebuilds a claim from same-demand complete baskets', () => {
  for (const priceChange of [-10, 0, 25]) {
    const input = pair(priceChange)
    const previous = structuredClone(input)
    const current = compareCurrentBaskets(input)
    const canonical = compareFullBaskets(input)

    assert.equal(input.baseline.unresolvedLineCount, 0)
    assert.equal(input.candidate.unresolvedLineCount, 0)
    assert.equal(current?.claimable, true)
    assert.equal(current?.outcome, priceChange < 0 ? 'better' : priceChange > 0 ? 'worse' : 'same')
    assert.deepEqual(current, canonical)
    assert.deepEqual(input, previous, 'refresh must not mutate planner/basket snapshots')
  }
})

test('a changed current candidate demand cannot reuse the previous claim', () => {
  const input = pair()
  const prior = compareFullBaskets(input)
  assert.equal(prior.claimable, true)
  const next = structuredClone(input)
  const index = next.candidate.lines.findIndex((line) => line.status === 'matched')
  assert.ok(index >= 0)
  const line = next.candidate.lines[index]
  next.candidate.lines[index] = {
    ...line,
    requirement: { ...line.requirement, amount: line.requirement.amount * 2 },
  }

  // The old comparison is still superficially valid for IDs and line totals.
  assert.equal(prior.baselineTotalCents, next.baseline.totalCents)
  assert.equal(prior.candidateTotalCents, next.candidate.totalCents)
  assert.equal(compareCurrentBaskets(next), null)
  assert.equal(prior.claimable, true, 'prior report remains untouched; callers must discard it')
})

test('recomputed comparison reflects a price change even if a cached result exists', () => {
  const initial = pair()
  const stale = compareFullBaskets(initial)
  const currentInput = pair(25)
  const current = compareCurrentBaskets(currentInput)

  assert.equal(stale.outcome, 'better')
  assert.equal(current?.outcome, 'worse')
  assert.equal(current?.deltaCents, currentInput.candidate.totalCents - currentInput.baseline.totalCents)
  assert.notEqual(current?.deltaCents, stale.deltaCents)
})

test('missing or corrupt nested pack metadata fails closed without throwing', () => {
  for (const corruption of [
    undefined,
    null,
    { amount: 0, unit: 'g', count: 1 },
    { amount: 25, unit: 'unknown', count: 1 },
    { amount: 50, unit: 'g', count: Number.POSITIVE_INFINITY },
  ]) {
    const current = pair()
    const index = current.candidate.lines.findIndex((line) => line.status === 'matched')
    assert.ok(index >= 0)
    current.candidate.lines[index] = { ...current.candidate.lines[index], pack: corruption }
    assert.doesNotThrow(() => compareCurrentBaskets(current))
    assert.equal(compareCurrentBaskets(current), null)
  }
})

test('empty weeks, asymmetric planned days and missing products cannot claim money', () => {
  assert.equal(compareCurrentBaskets({
    baseline: basket(baselineStore, 0, []),
    candidate: basket(candidateStore, 0, []),
  }), null)

  assert.equal(compareCurrentBaskets({
    baseline: basket(baselineStore),
    candidate: basket(candidateStore, 0, m2DefaultActiveDays.slice(0, -1)),
  }), null)

  const candidateProducts = controlledProducts(candidateStore).filter(
    (product) => !product.id.endsWith('garam-50'),
  )
  assert.equal(compareCurrentBaskets({
    baseline: basket(baselineStore),
    candidate: basket(candidateStore, 0, m2DefaultActiveDays, candidateProducts),
  }), null)
})

test('malformed snapshots and one-store self comparisons cannot expose a stale claim', () => {
  const good = pair()
  assert.equal(compareCurrentBaskets({ ...good, candidate: good.baseline }), null)
  assert.equal(compareCurrentBaskets(null), null)
  assert.equal(compareCurrentBaskets({ ...good, candidate: null }), null)
  assert.equal(compareCurrentBaskets({
    ...good,
    candidate: { ...good.candidate, lines: { 0: good.candidate.lines[0] } },
  }), null)
  assert.equal(compareCurrentBaskets({
    ...good,
    candidate: { ...good.candidate, selectedMealCount: '4' },
  }), null)
})

test('current canonical result never leaks a cached report into an invalid next state', () => {
  const initial = pair()
  const oldComparison = compareCurrentBaskets(initial)
  assert.equal(oldComparison?.claimable, true)

  const changed = structuredClone(initial)
  const target = changed.candidate.lines.findIndex((line) => line.status === 'matched')
  const line = changed.candidate.lines[target]
  changed.candidate.lines[target] = { ...line, pricePerPackCents: -1 }
  const before = structuredClone(changed)

  const refreshed = compareCurrentBaskets(changed)
  assert.equal(refreshed, null)
  assert.deepEqual(changed, before)
  assert.equal(oldComparison?.claimable, true, 'historical object was never re-used')
})
