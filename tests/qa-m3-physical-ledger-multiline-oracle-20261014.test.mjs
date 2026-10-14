import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// All values are generated fictional integer cents, not observed retailer prices.
// Use BigInt as an independent arithmetic oracle, never as API input.
const anchors = [0, 1, 19, 10_000, 1_000_000_000_000, Math.floor(Number.MAX_SAFE_INTEGER / 12)]

function fixture(anchor, seed) {
  const diffs = [
    (seed % 27) - 13,
    ((seed * 7) % 29) - 14,
    ((seed * 11) % 31) - 15,
  ]
  const lines = diffs.map((deltaCents, index) => {
    const baselineLineTotalCents = anchor + 50 + ((seed * (index + 3)) % 101)
    const candidateLineTotalCents = baselineLineTotalCents + deltaCents
    return {
      id: `synthetic-${index}`,
      ingredientLabel: `Synthetic line ${index}`,
      baselineLineTotalCents,
      candidateLineTotalCents,
      deltaCents,
    }
  })
  const baseline = lines.reduce((sum, line) => sum + BigInt(line.baselineLineTotalCents), 0n)
  const candidate = lines.reduce((sum, line) => sum + BigInt(line.candidateLineTotalCents), 0n)
  const delta = candidate - baseline
  assert.ok(baseline >= 0n && candidate >= 0n)
  assert.ok(baseline <= BigInt(Number.MAX_SAFE_INTEGER) && candidate <= BigInt(Number.MAX_SAFE_INTEGER))
  assert.equal(delta, diffs.reduce((sum, n) => sum + BigInt(n), 0n))
  const comparison = {
    claimable: true,
    outcome: delta < 0n ? 'better' : delta > 0n ? 'worse' : 'same',
    baselineTotalCents: Number(baseline),
    candidateTotalCents: Number(candidate),
    deltaCents: Number(delta),
    savingsCents: -Number(delta),
    lineDeltas: lines,
    reasons: [],
  }
  const evidence = lines.map((line) => ({
    lineId: line.id,
    effect: 'offer',
    deltaCents: line.deltaCents,
    evidenceRef: `synthetic-${line.id}`,
  }))
  return { comparison, evidence, diffs }
}

for (const anchor of anchors) {
  test(`M3 independent BigInt three-line ledger oracle near ${anchor}: 256 seeds`, () => {
    for (let seed = 0; seed < 256; seed += 1) {
      const { comparison, evidence, diffs } = fixture(anchor, seed)
      const full = attributeSavingsEffects({ comparison, evidence })
      assert.equal(full.status, 'complete', `anchor=${anchor}, seed=${seed}`)
      assert.equal(full.fullyAttributed, true)
      assert.equal(full.comparisonDeltaCents, comparison.deltaCents)
      assert.equal(full.effectTotals.offerCents, diffs.reduce((a, b) => a + b, 0))
      assert.equal(full.effectTotals.unknownCents, 0)

      // A change in physical line ordering cannot alter the financial answer.
      const reordered = attributeSavingsEffects({
        comparison: { ...comparison, lineDeltas: [...comparison.lineDeltas].reverse() },
        evidence: [...evidence].reverse(),
      })
      assert.deepEqual(reordered, full, `order drift: anchor=${anchor}, seed=${seed}`)

      // Keep two fully explained lines, deliberately omit evidence for the last.
      // A zero net basket difference is NOT enough to make a nonzero line disappear.
      const partial = attributeSavingsEffects({ comparison, evidence: evidence.slice(0, 2) })
      assert.equal(partial.status, diffs[2] === 0 ? 'complete' : 'partial')
      assert.equal(partial.fullyAttributed, diffs[2] === 0)
      assert.equal(partial.effectTotals.offerCents, diffs[0] + diffs[1])
      assert.equal(partial.effectTotals.unknownCents, diffs[2])

      // Independently mutate either physical store ledger without amending its
      // advertised signed line delta. Both must abstain despite a claimable root.
      for (const changedField of ['baselineLineTotalCents', 'candidateLineTotalCents']) {
        const forgedLines = comparison.lineDeltas.map((line, index) =>
          index === 1 ? { ...line, [changedField]: line[changedField] + 1 } : line
        )
        const bad = attributeSavingsEffects({
          comparison: { ...comparison, lineDeltas: forgedLines },
          evidence,
        })
        assert.equal(bad.status, 'unknown', `forgery ${changedField}: anchor=${anchor}, seed=${seed}`)
        assert.equal(bad.fullyAttributed, false)
        assert.equal(bad.effectTotals.unknownCents, null)
      }
    }
  })
}

test('M3 additive BigInt oracle rejects globally overflowing but individually safe rows', () => {
  const max = Number.MAX_SAFE_INTEGER
  const comparison = {
    claimable: true, outcome: 'same',
    baselineTotalCents: max, candidateTotalCents: max,
    deltaCents: 0, savingsCents: 0, reasons: [],
    lineDeltas: [
      { id: 'one', baselineLineTotalCents: max, candidateLineTotalCents: max, deltaCents: 0 },
      { id: 'two', baselineLineTotalCents: 1, candidateLineTotalCents: 1, deltaCents: 0 },
    ],
  }
  assert.ok(BigInt(max) + 1n > BigInt(max))
  const report = attributeSavingsEffects({ comparison, evidence: [] })
  assert.equal(report.status, 'unknown')
  assert.equal(report.fullyAttributed, false)
  assert.equal(report.effectTotals.unknownCents, null)
})
