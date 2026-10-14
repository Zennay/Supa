import assert from 'node:assert/strict'
import test from 'node:test'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Every number and identity is synthetic and never a retailer observation.
function comparison() {
  return {
    claimable: true,
    outcome: 'worse',
    baselineTotalCents: 100,
    candidateTotalCents: 105,
    deltaCents: 5,
    savingsCents: -5,
    reasons: [],
    lineDeltas: [{
      id: 'fictional-rice',
      ingredientLabel: 'Fictieve rijst',
      baselineLineTotalCents: 100,
      candidateLineTotalCents: 105,
      deltaCents: 5,
    }],
  }
}
function fullEvidence() {
  return [{
    lineId: 'fictional-rice',
    effect: 'offer',
    deltaCents: 5,
    evidenceRef: 'fictional-private-source',
  }]
}

test('M3 attribution: canonical two-store cent ledger may be accounted for only with matching evidence', () => {
  const report = attributeSavingsEffects({ comparison: comparison(), evidence: fullEvidence() })
  assert.equal(report.status, 'complete')
  assert.equal(report.fullyAttributed, true)
  assert.equal(report.effectTotals.offerCents, 5)
  assert.equal(report.effectTotals.unknownCents, 0)
})

// EXPECTED RED: direct foreign data may be claimable at the root while its
// detailed price provenance contradicts the root or the per-line delta.
// The canonical upstream comparator itself is a separate trust boundary.
const badRows = [
  ['baseline row contradicts per-line delta', { baselineLineTotalCents: 99 }],
  ['candidate row contradicts per-line delta', { candidateLineTotalCents: 106 }],
  ['both rows shift but contradict root baseline and candidate totals', {
    baselineLineTotalCents: 101, candidateLineTotalCents: 106,
  }],
  ['negative row price', { baselineLineTotalCents: -1 }],
  ['coercible string row price', { baselineLineTotalCents: '100' }],
  ['nonfinite row price', { candidateLineTotalCents: Number.NaN }],
  ['unsafe integer row price', { baselineLineTotalCents: Number.MAX_SAFE_INTEGER + 1 }],
]

for (const [label, modifications] of badRows) {
  test(`M3 expected RED: ${label} must never appear fully attributed`, () => {
    const original = comparison()
    const forged = {
      ...original,
      lineDeltas: [{ ...original.lineDeltas[0], ...modifications }],
    }
    const report = attributeSavingsEffects({ comparison: forged, evidence: fullEvidence() })
    assert.equal(report.status, 'unknown', String(label))
    assert.equal(report.fullyAttributed, false, String(label))
    assert.equal(report.effectTotals.unknownCents, null, String(label))
  })
}
