import assert from 'node:assert/strict'
import test from 'node:test'
import { comparisonLineHighlights } from '../src/features/basket/comparisonLineHighlights.ts'

// All five ingredients and prices are invented test identities.
// A rank is WHERE two complete baskets differ, never WHY or proof of savings.
function fictionalComparison(deltas) {
  const baselineTotalCents = deltas.length * 100
  const lines = deltas.map((delta, index) => ({
    id: `fictional-${index}`,
    ingredientLabel: `Fictief ingrediënt ${index}`,
    baselineLineTotalCents: 100,
    candidateLineTotalCents: 100 + delta,
    deltaCents: delta,
  }))
  const candidateTotalCents = lines.reduce((sum, line) => sum + line.candidateLineTotalCents, 0)
  const deltaCents = candidateTotalCents - baselineTotalCents
  return {
    claimable: true,
    outcome: deltaCents < 0 ? 'better' : deltaCents > 0 ? 'worse' : 'same',
    reasons: [], lineDeltas: lines,
    baselineTotalCents, candidateTotalCents, deltaCents,
    savingsCents: -deltaCents,
  }
}

function independentTopThree(deltas, limit = 3) {
  return deltas.map((delta, index) => ({ delta, index }))
    .filter(row => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.index - b.index)
    .slice(0, Math.min(limit, 3))
}

test('QA M3: all 3,125 five-line signed basket differences rank stable top three', () => {
  const values = [-3, -1, 0, 1, 3]
  let cases = 0
  for (const a of values) for (const b of values) for (const c of values)
    for (const d of values) for (const e of values) {
      const deltas = [a, b, c, d, e]
      const comparison = fictionalComparison(deltas)
      const original = JSON.stringify(comparison)
      for (const limit of [1, 2, 3, 7]) {
        const ranked = comparisonLineHighlights(comparison, limit)
        const expected = independentTopThree(deltas, limit)
        assert.deepEqual(ranked.map(row => row.id),
          expected.map(row => `fictional-${row.index}`), String(deltas))
        assert.deepEqual(ranked.map(row => row.direction),
          expected.map(row => row.delta < 0 ? 'lower' : 'higher'), String(deltas))
        assert.ok(ranked.every(row => typeof row.amountLabel === 'string' &&
          row.amountLabel.includes(',') && !/onbekend|bespaard|aanbieding/i.test(row.amountLabel)))
      }
      assert.equal(JSON.stringify(comparison), original, 'pure highlight helper cannot mutate its input')
      cases++
    }
  assert.equal(cases, 3125)
})

test('QA M3: forged total, line ledger and textual identities cannot reach visible money', () => {
  const good = fictionalComparison([-3, -1, 0, 1, 3])
  const invalid = [
    { ...good, claimable: false },
    { ...good, outcome: 'unknown' },
    { ...good, reasons: ['fictional missing line'] },
    { ...good, baselineTotalCents: good.baselineTotalCents + 1 },
    { ...good, candidateTotalCents: good.candidateTotalCents + 1 },
    { ...good, savingsCents: good.savingsCents + 1 },
    { ...good, deltaCents: good.deltaCents + 1 },
    { ...good, lineDeltas: [] },
    { ...good, lineDeltas: good.lineDeltas.map((line, i) =>
      i === 0 ? { ...line, baselineLineTotalCents: line.baselineLineTotalCents + 1 } : line) },
    { ...good, lineDeltas: good.lineDeltas.map((line, i) =>
      i === 0 ? { ...line, candidateLineTotalCents: line.candidateLineTotalCents + 1 } : line) },
    { ...good, lineDeltas: good.lineDeltas.map((line, i) =>
      i === 0 ? { ...line, id: good.lineDeltas[1].id } : line) },
    { ...good, lineDeltas: good.lineDeltas.map((line, i) =>
      i === 0 ? { ...line, ingredientLabel: 'Fictief\\u202Everkeerd' } : line) },
    { ...good, lineDeltas: good.lineDeltas.map((line, i) =>
      i === 0 ? { ...line, ingredientLabel: ' '.repeat(181) } : line) },
  ]
  for (const [index, comparison] of invalid.entries()) {
    assert.deepEqual(comparisonLineHighlights(comparison), [], `invalid ledger ${index}`)
  }
})
