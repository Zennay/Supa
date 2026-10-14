import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// All values and evidence are fictional. They are integer-cent identities,
// not observed retailer prices or permission to make public savings claims.
function makeComparison(first, second) {
  const deltas = [first, second]
  const baselineTotalCents = 1000
  const candidateTotalCents = baselineTotalCents + first + second
  const deltaCents = candidateTotalCents - baselineTotalCents
  return {
    claimable: true,
    outcome: deltaCents < 0 ? 'better' : deltaCents > 0 ? 'worse' : 'same',
    baselineTotalCents,
    candidateTotalCents,
    deltaCents,
    savingsCents: -deltaCents,
    reasons: [],
    lineDeltas: deltas.map((delta, index) => ({
      id: `fictional-line-${index + 1}`,
      ingredientLabel: `Invented ingredient ${index + 1}`,
      baselineLineTotalCents: 500,
      candidateLineTotalCents: 500 + delta,
      deltaCents: delta,
    })),
  }
}

function evidenceFor(comparison, indices = [0, 1]) {
  return indices.map(index => ({
    lineId: comparison.lineDeltas[index].id,
    effect: 'offer',
    deltaCents: comparison.lineDeltas[index].deltaCents,
    evidenceRef: `fictional-source-row-${index + 1}`,
  }))
}

test('QA M3: 441 positive/negative/zero paired deltas reconcile independently across three evidence states', () => {
  let checked = 0
  for (let first = -10; first <= 10; first++) {
    for (let second = -10; second <= 10; second++) {
      const comparison = makeComparison(first, second)
      const identity = `fictional delta=[${first},${second}]`
      assert.equal(comparison.lineDeltas.reduce((sum, line) => sum + line.deltaCents, 0),
        comparison.deltaCents, identity)

      const fullyProven = attributeSavingsEffects({
        comparison, evidence: evidenceFor(comparison),
      })
      assert.equal(fullyProven.status, 'complete', identity)
      assert.equal(fullyProven.fullyAttributed, true, identity)
      assert.equal(fullyProven.effectTotals.offerCents, first + second, identity)
      assert.equal(fullyProven.effectTotals.unknownCents, 0, identity)
      assert.equal(fullyProven.comparisonDeltaCents, first + second, identity)

      const noEvidence = attributeSavingsEffects({ comparison, evidence: [] })
      assert.equal(noEvidence.status, first === 0 && second === 0 ? 'complete' : 'partial', identity)
      assert.equal(noEvidence.fullyAttributed, first === 0 && second === 0, identity)
      assert.equal(noEvidence.effectTotals.unknownCents, first + second, identity)
      // Opposing signs must not cause an unproven nonzero line to disappear.
      if (first === -second && first !== 0) {
        assert.equal(noEvidence.status, 'partial', identity)
        assert.equal(noEvidence.fullyAttributed, false, identity)
      }

      const oneProven = attributeSavingsEffects({
        comparison, evidence: evidenceFor(comparison, [0]),
      })
      assert.equal(oneProven.status, second === 0 ? 'complete' : 'partial', identity)
      assert.equal(oneProven.fullyAttributed, second === 0, identity)
      assert.equal(oneProven.effectTotals.offerCents, first, identity)
      assert.equal(oneProven.effectTotals.unknownCents, second, identity)
      assert.ok(fullyProven.reasons.every(reason => !reason.includes('fictional-source')),
        'No private provenance in public description')
      checked++
    }
  }
  assert.equal(checked, 441)
})

test('QA M3: a two-line comparison with forged full-basket money must fail even with matching local evidence', () => {
  let checked = 0
  for (const first of [-10, -1, 0, 1, 10]) {
    for (const second of [-10, -1, 0, 1, 10]) {
      const good = makeComparison(first, second)
      for (const mismatch of [-101, -1, 1, 101]) {
        const corrupt = { ...good, deltaCents: good.deltaCents + mismatch }
        const report = attributeSavingsEffects({
          comparison: corrupt, evidence: evidenceFor(good),
        })
        assert.equal(report.status, 'unknown', `deltas ${first},${second} mismatch ${mismatch}`)
        assert.equal(report.fullyAttributed, false)
        assert.equal(report.effectTotals.unknownCents, null)
        checked++
      }
    }
  }
  assert.equal(checked, 100)
})

test('QA M3: empty comparisons and malformed direct line metadata cannot masquerade as fully attributed', () => {
  const valid = makeComparison(-2, 5)
  const cases = [
    { ...valid, lineDeltas: [] },
    { ...valid, lineDeltas: null },
    { ...valid, lineDeltas: [null, valid.lineDeltas[1]] },
    { ...valid, lineDeltas: [{ ...valid.lineDeltas[0], deltaCents: 'not-cents' }, valid.lineDeltas[1]] },
    { ...valid, lineDeltas: [{ ...valid.lineDeltas[0], deltaCents: Number.NaN }, valid.lineDeltas[1]] },
    { ...valid, lineDeltas: [{ ...valid.lineDeltas[0], id: '' }, valid.lineDeltas[1]] },
    { ...valid, lineDeltas: [valid.lineDeltas[0], { ...valid.lineDeltas[1], id: valid.lineDeltas[0].id }] },
  ]
  for (const [index, comparison] of cases.entries()) {
    const output = attributeSavingsEffects({ comparison, evidence: [] })
    assert.equal(output.status, 'unknown', String(index))
    assert.equal(output.fullyAttributed, false, String(index))
    assert.equal(output.effectTotals.unknownCents, null, String(index))
  }
})
