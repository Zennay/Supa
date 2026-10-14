import assert from 'node:assert/strict'
import test from 'node:test'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Purely invented direct-caller boundary; not a supermarket observation.
function canonical() {
  return {
    claimable: true, outcome: 'same',
    baselineTotalCents: 100, candidateTotalCents: 100,
    deltaCents: 0, savingsCents: 0, reasons: [],
    lineDeltas: [{
      id: 'fictional-rice', ingredientLabel: 'Invented ingredient',
      baselineLineTotalCents: 100, candidateLineTotalCents: 100,
      deltaCents: 0,
    }],
  }
}
function assertUnknown(result) {
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.ok(result.reasons.length > 0)
  assert.ok(result.reasons.every(x => typeof x === 'string' && x.length <= 200))
}
for (const [label, root] of [
  ['null', null],
  ['undefined', undefined],
  ['primitive string', 'UNTRUSTED_VALUE'],
  ['primitive number', 42],
  ['primitive boolean', false],
  ['empty array', []],
  ['nested array', [{}]],
]) {
  test(`product: malformed comparison root ${label} abstains without throwing`, () => {
    const result = attributeSavingsEffects({ comparison: root, evidence: [] })
    assertUnknown(result)
    assert.equal(result.comparisonDeltaCents, null)
    assert.doesNotMatch(result.reasons.join(' '), /UNTRUSTED_VALUE/)
  })
}
for (const [label, bad] of [
  ['null', null],
  ['undefined', undefined],
  ['string', 'UNTRUSTED_VALUE'],
  ['object', { personal: 'UNTRUSTED_VALUE' }],
  ['mixed members', ['valid', null]],
  ['blank reason', ['']],
  ['too long', ['x'.repeat(201)]],
]) {
  test(`product: malformed reasons ${label} are rejected before spreading`, () => {
    const result = attributeSavingsEffects({
      comparison: { ...canonical(), claimable: false, reasons: bad },
      evidence: [],
    })
    assertUnknown(result)
    assert.equal(result.comparisonDeltaCents, null)
    assert.doesNotMatch(result.reasons.join(' '), /UNTRUSTED_VALUE/)
  })
}
for (const value of [null, undefined, 'true', 1, 0, {}]) {
  test(`product: nonboolean claimable ${String(value)} never authorizes cents`, () => {
    const result = attributeSavingsEffects({ comparison: { ...canonical(), claimable: value }, evidence: [] })
    assertUnknown(result)
    assert.equal(result.comparisonDeltaCents, null)
  })
}
for (const [name, bad] of [
  ['null', null],
  ['undefined', undefined],
  ['string', '0'],
  ['nonfinite', Infinity],
  ['fractional', 0.1],
  ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ['object', { value: 0 }],
]) {
  test(`product: untrusted claimed delta ${name} is never exposed`, () => {
    const result = attributeSavingsEffects({
      comparison: { ...canonical(), deltaCents: bad },
      evidence: [],
    })
    assertUnknown(result)
    assert.equal(result.comparisonDeltaCents, null)
  })
}
test('product: valid same-price nonempty comparison still fully attributes zero', () => {
  const report = attributeSavingsEffects({ comparison: canonical(), evidence: [] })
  assert.equal(report.status, 'complete')
  assert.equal(report.fullyAttributed, true)
  assert.equal(report.comparisonDeltaCents, 0)
})
test('product: explicitly unclaimable input retains bounded human-readable reason', () => {
  const report = attributeSavingsEffects({
    comparison: {
      ...canonical(), claimable: false,
      outcome: 'unknown', deltaCents: null, savingsCents: null,
      reasons: ['fictional ingredient unresolved'],
    },
    evidence: [],
  })
  assertUnknown(report)
  assert.ok(report.reasons.includes('fictional ingredient unresolved'))
  assert.equal(report.comparisonDeltaCents, null)
})
