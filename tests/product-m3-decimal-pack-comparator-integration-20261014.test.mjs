import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

// This uses deliberately fictional one-ingredient baskets: not observed
// retailer prices, savings, availability, source rights, or M3 field proof.
const plan = [{ day: 'Ma', recipeId: 'mock-meal' }]
const activeDays = ['Ma']

function basket({ storeId, demand, demandUnit = 'g', packAmount, packUnit = 'g',
  packCount = 1, priceCents = 9, available = true }) {
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan, activeDays,
    recipes: [{
      id: 'mock-meal',
      title: 'Fictief rijstrecept',
      servings: 1,
      minutes: 10,
      tags: [],
      estimatedCost: 0,
      ingredients: [{
        id: 'rice',
        label: 'Rijst',
        query: 'rijst',
        amount: demand,
        unit: demandUnit,
      }],
    }],
    products: available ? [{
      id: storeId + '-rice',
      storeId,
      name: 'Rijst',
      packAmount,
      packUnit,
      packCount,
      priceCents,
      available: true,
    }] : [],
  })
}

function matched(b, expectedPacks, expectedCents) {
  assert.equal(b.lines.length, 1)
  assert.equal(b.matchedLineCount, 1)
  assert.equal(b.unresolvedLineCount, 0)
  assert.equal(b.lines[0].status, 'matched')
  assert.equal(b.lines[0].packs, expectedPacks)
  assert.equal(b.lines[0].lineTotalCents, expectedCents)
  assert.equal(b.totalCents, expectedCents)
}

function compared(pair, expectedDelta, expectedOutcome) {
  const before = structuredClone(pair)
  const result = compareFullBaskets(pair)
  assert.equal(result.claimable, true, result.reasons.join('; '))
  assert.equal(result.outcome, expectedOutcome)
  assert.equal(result.deltaCents, expectedDelta)
  assert.equal(result.savingsCents, -expectedDelta)
  assert.equal(result.lineDeltas.length, 1)
  assert.equal(result.lineDeltas[0].deltaCents, expectedDelta)
  assert.deepEqual(pair, before, 'comparison cannot mutate canonical baskets')
}

test('M3 physically exact 0.07 g demand buys seven 0.01 g packs, not eight', () => {
  const baseline = basket({ storeId: 'mock-a', demand: 0.07, packAmount: 0.01 })
  const candidate = basket({ storeId: 'mock-b', demand: 0.07, packAmount: 0.01, priceCents: 11 })
  matched(baseline, 7, 63)
  matched(candidate, 7, 77)
  compared({ baseline, candidate }, 14, 'worse')
})

test('M3 0.45 g demand fits exactly one three-times-0.15 g multipack', () => {
  const baseline = basket({ storeId: 'mock-a', demand: 0.45, packAmount: 0.15,
    packCount: 3, priceCents: 30 })
  const candidate = basket({ storeId: 'mock-b', demand: 0.45, packAmount: 0.15,
    packCount: 3, priceCents: 29 })
  matched(baseline, 1, 30)
  matched(candidate, 1, 29)
  compared({ baseline, candidate }, -1, 'better')
})

test('M3 genuine 0.00000000000000002 g overage still requires an eighth pack', () => {
  const baseline = basket({ storeId: 'mock-a', demand: 0.07000000000000002, packAmount: 0.01 })
  const candidate = basket({ storeId: 'mock-b', demand: 0.07000000000000002,
    packAmount: 0.01, priceCents: 11 })
  matched(baseline, 8, 72)
  matched(candidate, 8, 88)
  compared({ baseline, candidate }, 16, 'worse')
})

test('M3 exact decimal evidence never upgrades an unresolved candidate to savings', () => {
  const baseline = basket({ storeId: 'mock-a', demand: 0.07, packAmount: 0.01 })
  const candidate = basket({ storeId: 'mock-b', demand: 0.07,
    packAmount: 0.01, available: false })
  matched(baseline, 7, 63)
  assert.equal(candidate.matchedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 1)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
})
