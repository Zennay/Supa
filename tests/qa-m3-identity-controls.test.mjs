import assert from 'node:assert/strict'
import test from 'node:test'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

// Synthetic basket only. No observed retailer price or savings evidence.
function basket(storeId) {
  const line = {
    status: 'matched', id: 'rijst', ingredientLabel: 'Rijst',
    requirement: { amount: 200, unit: 'g' },
    productId: storeId + '-rijst', productName: 'Rijst 500 g',
    packs: 1, pack: { amount: 500, unit: 'g', count: 1 },
    pricePerPackCents: 129, lineTotalCents: 129,
    matchScore: 95, reasons: [],
  }
  return {
    store: { id: storeId, name: 'Synthetic test store' },
    selectedMealCount: 1, lines: [line],
    totalCents: 129, matchedLineCount: 1, unresolvedLineCount: 0,
  }
}
function pair() {
  return { baseline: basket('plus-test'), candidate: basket('dekamarkt-test') }
}
function abstains(input) {
  const before = JSON.stringify(input)
  const result = compareFullBaskets(input)
  assert.equal(result.outcome, 'unknown', JSON.stringify(result))
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.equal(JSON.stringify(input), before)
}

test('direction controls embedded in visible store IDs are not trusted', () => {
  for (const control of ['\u202e', '\u202a', '\u2066', '\u2069', '\u200f', '\u200e', '\u061c']) {
    for (const side of ['baseline', 'candidate']) {
      const input = pair()
      input[side].store.id = 'Store' + control + 'name'
      abstains(input)
    }
  }
})

test('matched financial identity fields reject mixed directional controls', () => {
  for (const field of ['id', 'ingredientLabel', 'productId', 'productName']) {
    for (const side of ['baseline', 'candidate']) {
      const input = pair()
      input[side].lines[0][field] = 'Rijst\u202e123'
      if (field === 'id' || field === 'ingredientLabel') {
        input[side === 'baseline' ? 'candidate' : 'baseline'].lines[0][field] = 'Rijst\u202e123'
      }
      abstains(input)
    }
  }
})

test('line breaks and ASCII controls cannot occur in financial identity labels', () => {
  for (const control of ['\n', '\r', '\t', '\u0000', '\u007f', '\u0085']) {
    const input = pair()
    input.baseline.lines[0].ingredientLabel = 'Rijst' + control + 'rest'
    input.candidate.lines[0].ingredientLabel = 'Rijst' + control + 'rest'
    abstains(input)
  }
})

test('visible international and composed emoji labels remain comparable', () => {
  for (const visible of ['Cr\u00e8me', 'e\u0301', '\u0628\u0650\u0633\u0645', '👩‍🍳', '🥕\ufe0f', 'Rijst-123']) {
    const input = pair()
    for (const side of ['baseline', 'candidate']) {
      const line = input[side].lines[0]
      line.id = visible
      line.ingredientLabel = visible
      line.productName = visible
      line.productId = visible
      Object.freeze(line.requirement)
      Object.freeze(line.pack)
      Object.freeze(line)
      Object.freeze(input[side].lines)
    }
    const result = compareFullBaskets(input)
    assert.equal(result.claimable, true, JSON.stringify({ visible, reasons: result.reasons }))
    assert.equal(result.outcome, 'same')
    assert.equal(result.deltaCents, 0)
    assert.equal(result.savingsCents, 0)
  }
})
