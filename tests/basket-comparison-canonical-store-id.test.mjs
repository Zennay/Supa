import assert from 'node:assert/strict'
import test from 'node:test'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function emptyBasket(storeId) {
  return {
    store: { id: storeId, name: storeId },
    lines: [],
    totalCents: 0,
    selectedMealCount: 0,
    matchedLineCount: 0,
    unresolvedLineCount: 0,
  }
}

test('canonical distinct store identifiers remain comparable', () => {
  const result = compareFullBaskets({
    baseline: emptyBasket('plus'),
    candidate: emptyBasket('dekamarkt'),
  })
  assert.equal(result.outcome, 'same')
  assert.equal(result.claimable, true)
  assert.equal(result.savingsCents, 0)
})

test('padded store identity never establishes a claimable second store', () => {
  for (const padded of ['plus ', ' plus', ' plus ', '\\tplus', 'plus\\n']) {
    const result = compareFullBaskets({
      baseline: emptyBasket('plus'),
      candidate: emptyBasket(padded),
    })
    assert.equal(result.outcome, 'unknown', padded)
    assert.equal(result.claimable, false, padded)
    assert.equal(result.savingsCents, null, padded)
    assert.equal(result.deltaCents, null, padded)
    assert.match(result.reasons.join(' '), /invalid store identity/, padded)
  }
})

test('padded baseline identity is also rejected', () => {
  const result = compareFullBaskets({
    baseline: emptyBasket('plus '),
    candidate: emptyBasket('dekamarkt'),
  })
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.savingsCents, null)
})
