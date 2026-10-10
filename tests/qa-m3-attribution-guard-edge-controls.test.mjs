import assert from 'node:assert/strict'
import test from 'node:test'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Acceptance-only edge cases for issue #1205, stacked on the separate
// source-repair candidate. All values are synthetic, not retailer evidence.
function comparison(overrides = {}) {
  return {
    outcome: 'same',
    claimable: true,
    baselineTotalCents: 100,
    candidateTotalCents: 100,
    deltaCents: 0,
    savingsCents: 0,
    lineDeltas: [{
      id: 'invented-ingredient',
      ingredientLabel: 'Invented ingredient',
      baselineLineTotalCents: 100,
      candidateLineTotalCents: 100,
      deltaCents: 0,
    }],
    reasons: [],
    ...overrides,
  }
}

function failsClosed(result) {
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.comparisonDeltaCents, null)
  assert.deepEqual(result.effectTotals, {
    packSizeCents: 0,
    offerCents: 0,
    planningCents: 0,
    unknownCents: null,
  })
  assert.ok(result.reasons.length > 0)
}

for (const [name, malformed] of [
  ['empty reason', ['']],
  ['whitespace-only reason', ['   ']],
  ['overlong reason', ['z'.repeat(201)]],
  ['object reason', [{ debug: 'fictional-private-marker' }]],
  ['nested array reason', [['fictional-private-marker']]],
  ['mixed null reason', ['valid synthetic reason', null]],
]) {
  test(`attribution rejects ${name} without copying its malformed payload`, () => {
    const result = attributeSavingsEffects({
      comparison: comparison({ reasons: malformed }),
      evidence: [],
    })
    failsClosed(result)
    assert.doesNotMatch(result.reasons.join(' '), /fictional-private-marker/)
    assert.ok(result.reasons.every((reason) => typeof reason === 'string' && reason.length <= 200))
  })
}

test('a valid exactly 200-character explanation is preserved as an unclaimable reason', () => {
  const reason = 'r'.repeat(200)
  const result = attributeSavingsEffects({
    comparison: comparison({
      claimable: false,
      outcome: 'unknown',
      deltaCents: null,
      savingsCents: null,
      reasons: [reason],
    }),
    evidence: [],
  })
  assert.equal(result.status, 'unknown')
  assert.equal(result.comparisonDeltaCents, null)
  assert.ok(result.reasons.includes(reason))
})

test('a one-character nonblank reason is still accepted', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      claimable: false,
      outcome: 'unknown',
      deltaCents: null,
      reasons: ['x'],
    }),
    evidence: [],
  })
  assert.equal(result.status, 'unknown')
  assert.ok(result.reasons.includes('x'))
})

test('boxed-Boolean true cannot assert financial claimability', () => {
  failsClosed(attributeSavingsEffects({
    comparison: comparison({ claimable: new Boolean(true) }),
    evidence: [],
  }))
})

test('a valid comparison with null prototype remains a supported ordinary record', () => {
  const record = Object.assign(Object.create(null), comparison())
  const result = attributeSavingsEffects({ comparison: record, evidence: [] })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.effectTotals.unknownCents, 0)
})

for (const [label, delta] of [
  ['maximum safe cent magnitude', Number.MAX_SAFE_INTEGER],
  ['minimum safe cent magnitude', Number.MIN_SAFE_INTEGER],
]) {
  test(`valid ${label} remains a partial, exactly accounted unknown effect`, () => {
    const lineDeltas = [{ ...comparison().lineDeltas[0], deltaCents: delta }]
    const result = attributeSavingsEffects({
      comparison: comparison({ deltaCents: delta, lineDeltas }),
      evidence: [],
    })
    assert.equal(result.status, 'partial')
    assert.equal(result.fullyAttributed, false)
    assert.equal(result.comparisonDeltaCents, delta)
    assert.equal(result.effectTotals.unknownCents, delta)
    assert.equal(result.effectTotals.offerCents, 0)
  })
}
