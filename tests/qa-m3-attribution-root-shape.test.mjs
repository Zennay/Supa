import assert from 'node:assert/strict'
import test from 'node:test'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Synthetic direct API input-shape regression for issue #1205.
// No real participant data, receipt, store pricing or measured savings.
const zeroLine = {
  id: 'fictional-ingredient',
  ingredientLabel: 'Fictional ingredient',
  baselineLineTotalCents: 100,
  candidateLineTotalCents: 100,
  deltaCents: 0,
}

function trustedComparison(overrides = {}) {
  return {
    outcome: 'same',
    claimable: true,
    baselineTotalCents: 100,
    candidateTotalCents: 100,
    deltaCents: 0,
    savingsCents: 0,
    lineDeltas: [{ ...zeroLine }],
    reasons: [],
    ...overrides,
  }
}

function expectNoAttributedMoney(result) {
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.comparisonDeltaCents, null)
  assert.deepEqual(result.effectTotals, {
    packSizeCents: 0,
    offerCents: 0,
    planningCents: 0,
    unknownCents: null,
  })
  assert.ok(Array.isArray(result.reasons))
  assert.ok(result.reasons.length >= 1)
  assert.ok(result.reasons.every((reason) =>
    typeof reason === 'string' &&
    reason.length > 0 &&
    reason.length <= 200
  ))
}

// The boundary receives persisted JSON and ordinary JS callers at runtime.
// TypeScript's comparison parameter annotation cannot reject these inputs.
for (const [label, invalidComparison] of [
  ['null root', null],
  ['missing root', undefined],
  ['numeric root', 123],
  ['string root', 'sensitive-untrusted-payload'],
  ['array root', []],
  ['nested array root', [{}]],
  ['boolean root', true],
]) {
  test(`attribution refuses ${label} without a thrown runtime exception`, () => {
    const result = attributeSavingsEffects({
      comparison: invalidComparison,
      evidence: [],
    })
    expectNoAttributedMoney(result)
    assert.doesNotMatch(result.reasons.join(' '), /sensitive-untrusted-payload/)
  })
}

for (const [label, invalidReasons] of [
  ['null reasons', null],
  ['missing reasons', undefined],
  ['scalar reasons', 1],
  ['object reasons', { text: 'sensitive-untrusted-payload' }],
  ['string reasons', 'sensitive-untrusted-payload'],
  ['array with malformed reason', ['sensitive-untrusted-payload', null]],
]) {
  test(`unclaimable attribution handles ${label} without leaked input or crashes`, () => {
    const result = attributeSavingsEffects({
      comparison: trustedComparison({
        claimable: false,
        outcome: 'unknown',
        deltaCents: null,
        savingsCents: null,
        reasons: invalidReasons,
      }),
      evidence: [],
    })
    expectNoAttributedMoney(result)
    // A non-array string must not be spread into a list of one-character
    // explanations, which would indirectly disclose the supplied text.
    assert.ok(result.reasons.length <= 5, 'malformed reasons must not expand into arbitrary fragments')
    assert.doesNotMatch(result.reasons.join(' '), /sensitive-untrusted-payload/)
  })
}

for (const [label, untrustedFlag] of [
  ['missing claimability flag', undefined],
  ['string claimability flag', 'true'],
  ['numeric claimability flag', 1],
]) {
  test(`attribution rejects ${label} instead of treating it as proven`, () => {
    const result = attributeSavingsEffects({
      comparison: trustedComparison({ claimable: untrustedFlag }),
      evidence: [],
    })
    expectNoAttributedMoney(result)
  })
}

test('valid nonempty same-price evidence can still be fully attributed', () => {
  const result = attributeSavingsEffects({
    comparison: trustedComparison(),
    evidence: [],
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.comparisonDeltaCents, 0)
  assert.equal(result.effectTotals.unknownCents, 0)
})

test('valid explicitly unclaimable comparison remains unknown with its safe reason', () => {
  const result = attributeSavingsEffects({
    comparison: trustedComparison({
      claimable: false,
      outcome: 'unknown',
      deltaCents: null,
      savingsCents: null,
      reasons: ['fictional baseline is unavailable'],
    }),
    evidence: [],
  })
  expectNoAttributedMoney(result)
  assert.ok(result.reasons.includes('fictional baseline is unavailable'))
})

for (const [label, malformedReasons] of [
  ['missing comparison reasons', undefined],
  ['null comparison reasons', null],
  ['non-array comparison reasons', 'sensitive-untrusted-payload'],
  ['non-string member in comparison reasons', [null]],
  ['non-string object member in comparison reasons', [{ value: 'sensitive-untrusted-payload' }]],
]) {
  test(`otherwise claimable comparison refuses ${label}`, () => {
    const result = attributeSavingsEffects({
      comparison: trustedComparison({ reasons: malformedReasons }),
      evidence: [],
    })
    expectNoAttributedMoney(result)
    assert.ok(result.reasons.length <= 5)
    assert.doesNotMatch(result.reasons.join(' '), /sensitive-untrusted-payload/)
  })
}

for (const [label, malformedDelta] of [
  ['missing basket delta', undefined],
  ['string basket delta', '0'],
  ['fractional basket delta', 0.5],
  ['nonfinite basket delta', Number.POSITIVE_INFINITY],
  ['NaN basket delta', Number.NaN],
  ['unsafe basket delta', Number.MAX_SAFE_INTEGER + 1],
  ['boolean basket delta', true],
  ['object basket delta', { cents: 0 }],
]) {
  test(`attribution never returns untrusted ${label} as known comparison money`, () => {
    const result = attributeSavingsEffects({
      comparison: trustedComparison({ deltaCents: malformedDelta }),
      evidence: [],
    })
    expectNoAttributedMoney(result)
  })
}
