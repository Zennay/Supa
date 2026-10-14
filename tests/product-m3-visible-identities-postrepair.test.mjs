import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function oneLineBasket(storeId) {
  const basket = buildOneStoreBasket({
    store: { id: storeId, name: 'Controlled synthetic store' },
    plan: [{ day: 'Ma', recipeId: 'rice' }],
    activeDays: ['Ma'],
    recipes: [{
      id: 'rice', title: 'Rice', minutes: 10, servings: 1, tags: [], estimatedCost: 1.2,
      ingredients: [{ id: 'rijst', label: 'Rijst', query: 'rijst', amount: 200, unit: 'g' }],
    }],
    products: [{
      id: storeId + '-rice', storeId, name: 'Rijst', packAmount: 500,
      packUnit: 'g', priceCents: 129, available: true,
    }],
  })
  assert.equal(basket.matchedLineCount, 1)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}
function pair() {
  return { baseline: oneLineBasket('shop-a'), candidate: oneLineBasket('shop-b') }
}
function unknown(baseline, candidate) {
  const original = JSON.stringify({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.equal(JSON.stringify({ baseline, candidate }), original)
}

test('postrepair: both baseline and candidate reject mark/format-only store identity', () => {
  for (const invalid of ['\u0301', '\u0650', '\ufe0f', '\u2060', '\u200d']) {
    for (const side of ['baseline', 'candidate']) {
      const basketPair = pair()
      basketPair[side].store = { ...basketPair[side].store, id: invalid }
      unknown(basketPair.baseline, basketPair.candidate)
    }
  }
})

test('postrepair: reject mark-only matched line IDs, labels, product names and product IDs', () => {
  for (const key of ['id', 'ingredientLabel', 'productId', 'productName']) {
    const { baseline, candidate } = pair()
    baseline.lines[0] = { ...baseline.lines[0], [key]: '\ufe0f' }
    if (key === 'id' || key === 'ingredientLabel') {
      candidate.lines[0] = { ...candidate.lines[0], [key]: '\ufe0f' }
    }
    unknown(baseline, candidate)
  }
})

test('postrepair: multilingual real text, emoji and ordinary IDs remain financially comparable', () => {
  for (const visible of ['Cr\u00e8me', 'e\u0301', '\u0628\u0650\u0633\u0645', '\u0995\u09be\u099b\u09c7', '\ud83e\udd55\ufe0f', '123']) {
    const { baseline, candidate } = pair()
    for (const basket of [baseline, candidate]) {
      basket.lines[0] = { ...basket.lines[0], id: visible, ingredientLabel: visible, productName: visible, productId: visible }
    }
    const result = compareFullBaskets({ baseline, candidate })
    assert.equal(result.claimable, true, JSON.stringify({ visible, reasons: result.reasons }))
    assert.equal(result.outcome, 'same')
    assert.equal(result.deltaCents, 0)
    assert.equal(result.savingsCents, 0)
    assert.equal(result.lineDeltas.length, 1)
  }
})

test('postrepair: safe visible identity does not relax exact pack or money validation', () => {
  const { baseline, candidate } = pair()
  baseline.lines[0] = { ...baseline.lines[0], productName: 'R\u0133st', packs: 2 }
  unknown(baseline, candidate)
  const other = pair()
  other.candidate.totalCents += 1
  unknown(other.baseline, other.candidate)
})
