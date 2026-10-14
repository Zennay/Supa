import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Invented amounts only: this is not retail, receipt, or savings evidence.
function ledger(overrides = {}) {
  return {
    claimable: true,
    outcome: 'worse',
    baselineTotalCents: 100,
    candidateTotalCents: 105,
    deltaCents: 5,
    savingsCents: -5,
    reasons: [],
    lineDeltas: [{
      id: 'invented-rice',
      ingredientLabel: 'Invented rice',
      baselineLineTotalCents: 100,
      candidateLineTotalCents: 105,
      deltaCents: 5,
    }],
    ...overrides,
  }
}

const evidence = [{
  lineId: 'invented-rice',
  effect: 'offer',
  deltaCents: 5,
  evidenceRef: 'invented-evidence',
}]

function unknown(comparison) {
  const result = attributeSavingsEffects({ comparison, evidence })
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.ok(result.reasons.length > 0)
}

test('fully evidenced, reconciled physical line remains complete', () => {
  const result = attributeSavingsEffects({ comparison: ledger(), evidence })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.effectTotals.offerCents, 5)
})

test('valid but unexplained difference remains partial', () => {
  const result = attributeSavingsEffects({ comparison: ledger(), evidence: [] })
  assert.equal(result.status, 'partial')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, 5)
})

test('physical nonempty zero-delta line remains fully accounted for', () => {
  const result = attributeSavingsEffects({
    comparison: ledger({
      outcome: 'same',
      candidateTotalCents: 100,
      deltaCents: 0,
      savingsCents: 0,
      lineDeltas: [{ ...ledger().lineDeltas[0], candidateLineTotalCents: 100, deltaCents: 0 }],
    }),
    evidence: [],
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
})

for (const [name, patch] of [
  ['incorrect baseline line price', { baselineLineTotalCents: 99 }],
  ['incorrect candidate line price', { candidateLineTotalCents: 106 }],
  ['shifted baseline and candidate that still agree on delta', {
    baselineLineTotalCents: 101,
    candidateLineTotalCents: 106,
  }],
  ['negative baseline', { baselineLineTotalCents: -1 }],
  ['negative candidate', { candidateLineTotalCents: -1 }],
  ['coercible baseline string', { baselineLineTotalCents: '100' }],
  ['coercible candidate string', { candidateLineTotalCents: '105' }],
  ['nonfinite baseline', { baselineLineTotalCents: Number.NaN }],
  ['nonfinite candidate', { candidateLineTotalCents: Infinity }],
  ['unsafe integer baseline', { baselineLineTotalCents: Number.MAX_SAFE_INTEGER + 1 }],
  ['unsafe integer candidate', { candidateLineTotalCents: Number.MAX_SAFE_INTEGER + 1 }],
  ['missing baseline field', { baselineLineTotalCents: undefined }],
  ['missing candidate field', { candidateLineTotalCents: undefined }],
]) {
  test(`inconsistent physical ledger rejects ${name}`, () => {
    unknown(ledger({
      lineDeltas: [{ ...ledger().lineDeltas[0], ...patch }],
    }))
  })
}

for (const [name, overrides] of [
  ['negative root total', { baselineTotalCents: -1 }],
  ['nonfinite root total', { baselineTotalCents: Infinity }],
  ['string root total', { candidateTotalCents: '105' }],
  ['root delta does not equal prices', { deltaCents: 6 }],
  ['unsafe root difference', { baselineTotalCents: Number.MAX_SAFE_INTEGER }],
]) {
  test(`inconsistent root ledger rejects ${name}`, () => unknown(ledger(overrides)))
}

test('inherited price fields cannot masquerade as physical line observations', () => {
  const base = { baselineLineTotalCents: 100 }
  const row = Object.assign(Object.create(base), {
    id: 'invented-rice',
    candidateLineTotalCents: 105,
    deltaCents: 5,
  })
  unknown(ledger({ lineDeltas: [row] }))
})

test('getter-based price fields cannot masquerade as physical line observations', () => {
  const row = { ...ledger().lineDeltas[0] }
  Object.defineProperty(row, 'baselineLineTotalCents', {
    get() { throw new Error('price getter should not run') },
    enumerable: true,
  })
  unknown(ledger({ lineDeltas: [row] }))
})

test('two individually correct lines must still reconcile to whole-store totals', () => {
  unknown(ledger({
    lineDeltas: [
      { ...ledger().lineDeltas[0], baselineLineTotalCents: 99, candidateLineTotalCents: 104 },
      { id: 'second-line', baselineLineTotalCents: 0, candidateLineTotalCents: 0, deltaCents: 0 },
    ],
  }))
})

test('aggregate line sums exceeding safe integer cents fail closed', () => {
  const huge = Number.MAX_SAFE_INTEGER
  unknown(ledger({
    baselineTotalCents: huge,
    candidateTotalCents: huge,
    deltaCents: 0,
    lineDeltas: [
      { id: 'a', baselineLineTotalCents: huge, candidateLineTotalCents: huge, deltaCents: 0 },
      { id: 'b', baselineLineTotalCents: 1, candidateLineTotalCents: 1, deltaCents: 0 },
    ],
  }))
})

test('malformed or duplicate physical rows never become a vacuous complete result', () => {
  unknown(ledger({ lineDeltas: [] }))
  unknown(ledger({ lineDeltas: null }))
  unknown(ledger({ lineDeltas: [null] }))
  unknown(ledger({ lineDeltas: [ledger().lineDeltas[0], ledger().lineDeltas[0]] }))
})
