import assert from 'node:assert/strict'
import test from 'node:test'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Invented monetary values; no observations, receipt, or retailer rights.
function basket(baseline, candidate) {
  const delta = candidate - baseline
  return {
    claimable: true,
    outcome: delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same',
    baselineTotalCents: baseline,
    candidateTotalCents: candidate,
    deltaCents: delta,
    savingsCents: -delta,
    reasons: [],
    lineDeltas: [{
      id: 'fictional-one',
      ingredientLabel: 'Fictieve ingredient',
      baselineLineTotalCents: baseline,
      candidateLineTotalCents: candidate,
      deltaCents: delta,
    }],
  }
}
function evidence(delta) {
  return [{ lineId: 'fictional-one', effect: 'offer', deltaCents: delta, evidenceRef: 'fictional-observation' }]
}

// These positive controls ensure the stricter contract does not silence genuine
// complete same-demand comparisons, including no-change and worse outcomes.
for (const [name, baseline, candidate] of [
  ['better', 105, 100],
  ['same', 100, 100],
  ['worse', 100, 105],
]) {
  test(`positive M3 physical full-basket outcome ${name} stays fully attributed`, () => {
    const current = basket(baseline, candidate)
    const result = attributeSavingsEffects({ comparison: current, evidence: evidence(current.deltaCents) })
    assert.equal(result.status, 'complete')
    assert.equal(result.fullyAttributed, true)
    assert.equal(result.comparisonDeltaCents, current.deltaCents)
  })
}

test('positive M3 unexplained cents remain partial rather than falsely complete', () => {
  const result = attributeSavingsEffects({ comparison: basket(100, 105), evidence: [] })
  assert.equal(result.status, 'partial')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, 5)
})

// EXPECTED RED on current main: the exported direct API trusts caller-provided
// claimable:true even when outcome and claimed savings contradict the physical
// and internally reconciled monetary ledger. Comparator callers may be safe;
// this directly checks the independent attribution trust boundary.
for (const [name, patch] of [
  ['claim says better for a physically more expensive basket', { outcome: 'better' }],
  ['claim says same for a physically more expensive basket', { outcome: 'same' }],
  ['claim says unknown yet still requires complete attribution', { outcome: 'unknown' }],
  ['missing outcome', { outcome: undefined }],
  ['wrong-sign savings cents', { savingsCents: 5 }],
  ['inflated positive savings cents', { savingsCents: 500 }],
  ['missing savings cents', { savingsCents: null }],
  ['nonfinite savings cents', { savingsCents: Number.NaN }],
  ['coercible string savings cents', { savingsCents: '-5' }],
]) {
  test(`M3 expected RED: contradictory claimable root ${name} must abstain`, () => {
    const forged = { ...basket(100, 105), ...patch }
    const result = attributeSavingsEffects({ comparison: forged, evidence: evidence(5) })
    assert.equal(result.status, 'unknown', name)
    assert.equal(result.fullyAttributed, false, name)
    assert.equal(result.effectTotals.unknownCents, null, name)
  })
}

test('M3 expected RED: better and zero outcome cannot be falsely advertised as worse', () => {
  for (const [baseline, candidate, forgedOutcome] of [
    [105, 100, 'worse'],
    [100, 100, 'better'],
    [100, 100, 'worse'],
  ]) {
    const forged = { ...basket(baseline, candidate), outcome: forgedOutcome }
    const result = attributeSavingsEffects({ comparison: forged, evidence: evidence(forged.deltaCents) })
    assert.equal(result.status, 'unknown')
    assert.equal(result.fullyAttributed, false)
    assert.equal(result.effectTotals.unknownCents, null)
  }
})
