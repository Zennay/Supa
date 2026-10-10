import assert from 'node:assert/strict'
import test from 'node:test'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Only fictional, direct API JSON boundaries. No real retailer/receipt data.
function comparison(lineDeltas) {
  return {
    outcome: 'same',
    claimable: true,
    baselineTotalCents: 100,
    candidateTotalCents: 100,
    deltaCents: 0,
    savingsCents: 0,
    lineDeltas,
    reasons: [],
  }
}

const matched = {
  id: 'fictional-line',
  ingredientLabel: 'Invented ingredient',
  baselineLineTotalCents: 100,
  candidateLineTotalCents: 100,
  deltaCents: 0,
}

for (const [name, rawLine] of [
  ['null array entry', null],
  ['undefined array entry', undefined],
  ['nested array entry', []],
  ['numeric entry', 42],
  ['missing integer-cent line delta', { ...matched, deltaCents: null }],
  ['string-based cent delta', { ...matched, deltaCents: '0' }],
  ['nonfinite cent delta', { ...matched, deltaCents: Number.NaN }],
]) {
  test(`M3 comparison attribution fails closed for ${name} without exceptions`, () => {
    const result = attributeSavingsEffects({
      comparison: comparison([rawLine]),
      evidence: [],
    })
    assert.equal(result.status, 'unknown')
    assert.equal(result.fullyAttributed, false)
    assert.equal(result.effectTotals.unknownCents, null)
    assert.equal(result.effectTotals.offerCents, 0)
    assert.ok(result.reasons.length > 0)
  })
}

test('valid nonempty zero-delta comparison line still has complete attribution', () => {
  const result = attributeSavingsEffects({
    comparison: comparison([{ ...matched }]),
    evidence: [],
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.effectTotals.unknownCents, 0)
})
