import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const baselineStore = { ...m2Store, id: 'empty-week-plus', name: 'PLUS' }
const candidateStore = { ...m2Store, id: 'empty-week-dekamarkt', name: 'DekaMarkt' }

function makeBasket(store, activeDays) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139,
    },
  ]
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

function assertNoFinancialClaim(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('product #1051: a genuinely empty planner week remains empty but cannot establish equal-price savings', () => {
  const baseline = makeBasket(baselineStore, [])
  const candidate = makeBasket(candidateStore, [])
  for (const basket of [baseline, candidate]) {
    assert.equal(basket.selectedMealCount, 0)
    assert.equal(basket.totalCents, 0)
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 0)
    assert.deepEqual(basket.lines, [])
  }
  const before = JSON.stringify({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  assertNoFinancialClaim(result)
  assert.match(result.reasons.join(' '), /no planned meals or basket ingredients/)
  assert.equal(JSON.stringify({ baseline, candidate }), before)
})

test('product #1051: an empty basket cannot be compared with a planned basket in either store order', () => {
  const empty = makeBasket(baselineStore, [])
  const planned = makeBasket(candidateStore, m2DefaultActiveDays)
  assert.ok(planned.selectedMealCount > 0)
  assert.ok(planned.lines.length > 0)
  for (const [baseline, candidate] of [[empty, planned], [planned, empty]]) {
    const result = compareFullBaskets({ baseline, candidate })
    assertNoFinancialClaim(result)
    assert.match(result.reasons.join(' '), /no planned meals or basket ingredients/)
    assert.match(result.reasons.join(' '), /different number of meals/)
  }
})

test('product #1051: fabricated zero-meal counters cannot turn a populated shopping basket into a savings claim', () => {
  const baseline = makeBasket(baselineStore, m2DefaultActiveDays)
  const candidate = makeBasket(candidateStore, m2DefaultActiveDays)
  baseline.selectedMealCount = 0
  candidate.selectedMealCount = 0
  assert.ok(baseline.lines.length > 0)
  const result = compareFullBaskets({ baseline, candidate })
  assertNoFinancialClaim(result)
  assert.match(result.reasons.join(' '), /no planned meals or basket ingredients/)
})

test('product #1051: populated equal-price baskets remain claimable even with a zero-cent matched total', () => {
  const baseline = makeBasket(baselineStore, m2DefaultActiveDays)
  const candidate = makeBasket(candidateStore, m2DefaultActiveDays)
  for (const basket of [baseline, candidate]) {
    assert.ok(basket.matchedLineCount > 0)
    assert.equal(basket.unresolvedLineCount, 0)
    basket.lines = basket.lines.map((line) =>
      line.status === 'matched'
        ? { ...line, pricePerPackCents: 0, lineTotalCents: 0 }
        : line,
    )
    basket.totalCents = 0
  }
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, baseline.matchedLineCount)
  assert.deepEqual(result.reasons, [])
})
