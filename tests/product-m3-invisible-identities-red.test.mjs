import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Controlled fixtures only: no observed supermarket price or M3 savings proof.
function storeBasket(storeId) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true, priceCents: 139,
  })
  const basket = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(basket.matchedLineCount, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

function pair() {
  return {
    baseline: storeBasket('controlled-plus'),
    candidate: storeBasket('controlled-dekamarkt'),
  }
}

function assertAbstains(baseline, candidate) {
  const before = JSON.stringify({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.equal(JSON.stringify({ baseline, candidate }), before)
}

test('M3 comparison refuses store IDs without a visible Unicode base', () => {
  for (const invisible of ['\u0301', '\u0650', '\ufe0f', '\u00ad']) {
    const { baseline, candidate } = pair()
    baseline.store = { ...baseline.store, id: invisible }
    assertAbstains(baseline, candidate)
  }
})

test('M3 comparison refuses ingredient IDs and labels made only of marks', () => {
  for (const key of ['id', 'ingredientLabel']) {
    for (const invisible of ['\u0301', '\u0650', '\ufe0f']) {
      const { baseline, candidate } = pair()
      baseline.lines[0] = { ...baseline.lines[0], [key]: invisible }
      candidate.lines[0] = { ...candidate.lines[0], [key]: invisible }
      assertAbstains(baseline, candidate)
    }
  }
})

test('M3 comparison refuses matched product IDs and names without visible base', () => {
  for (const key of ['productId', 'productName']) {
    for (const invisible of ['\ufe0f', '\u200d', '\u0301']) {
      const { baseline, candidate } = pair()
      baseline.lines[0] = { ...baseline.lines[0], [key]: invisible }
      assertAbstains(baseline, candidate)
    }
  }
})

test('M3 comparison preserves visible accented, non-Latin and emoji identities', () => {
  for (const visible of ['Caf\u00e9', 'e\u0301', '\u0628\u0650\u0633\u0645', '\u0995\u09be\u099b\u09c7', '\ud83e\udd55\ufe0f', '123']) {
    const { baseline, candidate } = pair()
    baseline.lines[0] = { ...baseline.lines[0], ingredientLabel: visible, productName: visible }
    candidate.lines[0] = { ...candidate.lines[0], ingredientLabel: visible, productName: visible }
    const result = compareFullBaskets({ baseline, candidate })
    assert.equal(result.claimable, true, JSON.stringify({ visible, reasons: result.reasons }))
    assert.equal(result.outcome, 'same')
    assert.equal(result.deltaCents, 0)
  }
})
