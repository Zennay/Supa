import test from 'node:test'
import assert from 'node:assert/strict'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Fictional direct-API values only. No observed retailer prices or savings.
function comparison(baseline = 100, candidate = 105) {
  const deltaCents = candidate - baseline
  return {
    claimable: true,
    outcome: deltaCents < 0 ? 'better' : deltaCents > 0 ? 'worse' : 'same',
    baselineTotalCents: baseline,
    candidateTotalCents: candidate,
    deltaCents,
    savingsCents: -deltaCents,
    reasons: [],
    lineDeltas: [{
      id: 'fictional-line',
      ingredientLabel: 'Invented rice',
      baselineLineTotalCents: baseline,
      candidateLineTotalCents: candidate,
      deltaCents,
    }],
  }
}
function evidence(deltaCents) {
  return [{
    lineId: 'fictional-line',
    effect: 'pack-size',
    deltaCents,
    evidenceRef: 'synthetic-owned-proof',
  }]
}
function assertUnknown(c) {
  const result = attributeSavingsEffects({ comparison: c, evidence: evidence(c.deltaCents) })
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /outcome or savings disagrees/)
}

for (const [baseline, candidate] of [
  [105, 100], [100, 100], [100, 105], [0, 0],
  [0, 1], [1, 0], [10_000, 5_000], [5_000, 10_000],
]) {
  test(`claimable physical ${baseline}→${candidate} retains complete exact signed explanation`, () => {
    const c = comparison(baseline, candidate)
    const result = attributeSavingsEffects({ comparison: c, evidence: evidence(c.deltaCents) })
    assert.equal(result.status, 'complete')
    assert.equal(result.fullyAttributed, true)
    assert.equal(result.comparisonDeltaCents, c.deltaCents)
    assert.equal(result.effectTotals.unknownCents, 0)
  })
}
test('unexplained real row cents remain explicitly partial', () => {
  const result = attributeSavingsEffects({ comparison: comparison(100, 105), evidence: [] })
  assert.equal(result.status, 'partial')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, 5)
})

for (const [label, patch] of [
  ['false improvement', { outcome: 'better' }],
  ['false unchanged', { outcome: 'same' }],
  ['unknown outcome', { outcome: 'unknown' }],
  ['wrong savings sign', { savingsCents: 5 }],
  ['invented savings amount', { savingsCents: 500 }],
  ['missing outcome', { outcome: undefined }],
  ['missing savings', { savingsCents: undefined }],
  ['null savings', { savingsCents: null }],
  ['nonfinite savings', { savingsCents: Infinity }],
  ['NaN savings', { savingsCents: NaN }],
  ['unsafe savings', { savingsCents: Number.MAX_SAFE_INTEGER + 1 }],
  ['string savings', { savingsCents: '-5' }],
  ['boolean savings', { savingsCents: false }],
]) {
  test(`direct root money guard rejects ${label}`, () => {
    assertUnknown({ ...comparison(), ...patch })
  })
}
for (const [baseline, candidate, outcome] of [
  [105, 100, 'worse'],
  [100, 100, 'worse'],
  [100, 100, 'better'],
  [0, 1, 'better'],
  [1, 0, 'same'],
]) {
  test(`direct root rejects ${baseline}→${candidate} falsely marked ${outcome}`, () => {
    assertUnknown({ ...comparison(baseline, candidate), outcome })
  })
}

test('inherited claimed outcome is not trusted', () => {
  const c = comparison()
  delete c.outcome
  Object.setPrototypeOf(c, { outcome: 'worse' })
  assertUnknown(c)
})

test('inherited claimed savings is not trusted', () => {
  const c = comparison()
  delete c.savingsCents
  Object.setPrototypeOf(c, { savingsCents: -5 })
  assertUnknown(c)
})

for (const field of ['outcome', 'savingsCents']) {
  test(`accessor-based root ${field} is refused without invoking it`, () => {
    const c = comparison()
    Object.defineProperty(c, field, {
      enumerable: true,
      get() { throw Error('accessor must never execute') },
    })
    assertUnknown(c)
  })
}

test('physically valid offsetting lines with zero root delta remain complete', () => {
  const c = comparison(250, 250)
  c.lineDeltas = [
    { id: 'fictional-a', baselineLineTotalCents: 150, candidateLineTotalCents: 100, deltaCents: -50 },
    { id: 'fictional-b', baselineLineTotalCents: 100, candidateLineTotalCents: 150, deltaCents: 50 },
  ]
  const result = attributeSavingsEffects({
    comparison: c,
    evidence: [
      { lineId: 'fictional-a', effect: 'pack-size', deltaCents: -50, evidenceRef: 'synthetic-a' },
      { lineId: 'fictional-b', effect: 'offer', deltaCents: 50, evidenceRef: 'synthetic-b' },
    ],
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.comparisonDeltaCents, 0)
})
