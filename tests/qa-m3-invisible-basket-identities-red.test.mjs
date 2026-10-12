import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Controlled M2 prices, not observed retailer data. No production or M3 claim.
function completeBasket(storeId, priceDelta = 0) {
  const store = { id: storeId, name: 'Synthetic test store' }
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: Math.max(0, product.priceCents + priceDelta),
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDelta,
    },
  ]
  const basket = buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

function pair() {
  return {
    baseline: completeBasket('qa-baseline', 0),
    candidate: completeBasket('qa-candidate', -10),
  }
}

function replaceFirstMatched(basket, field, value) {
  const index = basket.lines.findIndex((line) => line.status === 'matched')
  assert.ok(index >= 0)
  basket.lines[index] = { ...basket.lines[index], [field]: value }
}

function assertNotClaimable(baseline, candidate, reason) {
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false, 'unreadable identity must never support savings')
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), reason)
}

test('M3 rejects a format-only store identity rather than claiming synthetic savings', () => {
  const { baseline, candidate } = pair()
  baseline.store = { ...baseline.store, id: '\u200B\u2060' }
  assertNotClaimable(baseline, candidate, /invalid store identity/)
})

test('M3 rejects matching format-only ingredient IDs on both baskets', () => {
  const { baseline, candidate } = pair()
  for (const basket of [baseline, candidate]) {
    replaceFirstMatched(basket, 'id', '\u200D\u034F')
  }
  assertNotClaimable(baseline, candidate, /invalid matched-line identity/)
})

test('M3 rejects matching combining-mark-only ingredient labels on both baskets', () => {
  const { baseline, candidate } = pair()
  for (const basket of [baseline, candidate]) {
    replaceFirstMatched(basket, 'ingredientLabel', '\u0301')
  }
  assertNotClaimable(baseline, candidate, /invalid matched-line identity/)
})

test('M3 rejects a format-only matched product ID', () => {
  const { baseline, candidate } = pair()
  replaceFirstMatched(baseline, 'productId', '\u2060')
  assertNotClaimable(baseline, candidate, /invalid matched-line identity/)
})

test('M3 rejects a combining-mark-only matched product name', () => {
  const { baseline, candidate } = pair()
  replaceFirstMatched(candidate, 'productName', '\u0301\u034F')
  assertNotClaimable(baseline, candidate, /invalid matched-line identity/)
})

test('M3 permits readable multilingual, decomposed and emoji identities', () => {
  const { baseline, candidate } = pair()
  baseline.store = { ...baseline.store, id: 'winkel-東京' }
  candidate.store = { ...candidate.store, id: 'winkel-🛒' }
  for (const basket of [baseline, candidate]) {
    replaceFirstMatched(basket, 'ingredientLabel', 'cafe\u0301 日本語 👩‍🍳')
  }
  replaceFirstMatched(baseline, 'productName', 'Tomaten 🍅')
  replaceFirstMatched(candidate, 'productId', 'product-cafe\u0301')

  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'better')
  assert.ok(result.savingsCents > 0)
  assert.deepEqual(result.reasons, [])
})
