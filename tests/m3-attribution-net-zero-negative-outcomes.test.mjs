import test from 'node:test'
import assert from 'node:assert/strict'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Deliberately minimal claimable comparison snapshots: isolate attribution's
// contract from retailer fixtures and avoid manufacturing real price evidence.
function comparison(lines) {
  return {
    claimable: true,
    deltaCents: lines.reduce((sum, line) => sum + line.deltaCents, 0),
    lineDeltas: lines.map(([id, deltaCents]) => ({ id, deltaCents })),
    reasons: [],
  }
}

function snapshot(entries) {
  const lines = entries.map(([id, deltaCents]) => ({ id, deltaCents }))
  return {
    claimable: true,
    deltaCents: lines.reduce((sum, line) => sum + line.deltaCents, 0),
    lineDeltas: lines,
    reasons: [],
  }
}

const entry = (lineId, effect, deltaCents, evidenceRef) => ({
  lineId, effect, deltaCents, evidenceRef,
})

test('mixed positive and negative lines remain incomplete even if basket delta nets to zero', () => {
  const result = attributeSavingsEffects({
    comparison: snapshot([['rice', -120], ['vegetables', 120]]),
    evidence: [entry('rice', 'offer', -120, 'offer-observation-a')],
  })
  assert.equal(result.status, 'partial')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.comparisonDeltaCents, 0)
  assert.deepEqual(result.effectTotals, {
    packSizeCents: 0, offerCents: -120, planningCents: 0, unknownCents: 120,
  })
})

test('a complete and genuinely worse candidate preserves its positive cent delta', () => {
  const result = attributeSavingsEffects({
    comparison: snapshot([['rice', 99], ['vegetables', 1]]),
    evidence: [
      entry('rice', 'pack-size', 99, 'pack-observation'),
      entry('vegetables', 'offer', 1, 'offer-observation'),
    ],
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.comparisonDeltaCents, 100)
  assert.equal(result.effectTotals.unknownCents, 0)
  assert.equal(result.effectTotals.packSizeCents, 99)
  assert.equal(result.effectTotals.offerCents, 1)
})

test('one offsetting over-attributed line cannot be disguised by the basket net delta', () => {
  const result = attributeSavingsEffects({
    comparison: snapshot([['rice', -100], ['vegetables', 100]]),
    evidence: [
      entry('rice', 'offer', -101, 'first-quote'),
      entry('vegetables', 'pack-size', 101, 'second-quote'),
    ],
  })
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /exceeds line delta/)
})

test('same-demand planning attribution cannot explain nonzero cost changes', () => {
  const result = attributeSavingsEffects({
    comparison: snapshot([['rice', -75]]),
    evidence: [entry('rice', 'planning', -75, 'planning-claim')],
  })
  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.match(result.reasons.join(' '), /planning attribution must be zero/)
})
