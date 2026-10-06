import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

function comparison(overrides = {}) {
  return {
    outcome: 'better',
    claimable: true,
    baselineTotalCents: 3000,
    candidateTotalCents: 2910,
    deltaCents: -90,
    savingsCents: 90,
    lineDeltas: [
      {
        id: 'tomato',
        ingredientLabel: 'Tomato',
        baselineLineTotalCents: 500,
        candidateLineTotalCents: 380,
        deltaCents: -120,
      },
      {
        id: 'rice',
        ingredientLabel: 'Rice',
        baselineLineTotalCents: 400,
        candidateLineTotalCents: 430,
        deltaCents: 30,
      },
    ],
    reasons: [],
    ...overrides,
  }
}

test('M3 attribution only becomes complete when every line delta is exactly evidenced', () => {
  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      {
        lineId: 'tomato',
        effect: 'offer',
        deltaCents: -80,
        evidenceRef: 'observed-week-2026-10-04:tomato-offer',
      },
      {
        lineId: 'tomato',
        effect: 'pack-size',
        deltaCents: -40,
        evidenceRef: 'observed-week-2026-10-04:tomato-pack',
      },
      {
        lineId: 'rice',
        effect: 'pack-size',
        deltaCents: 30,
        evidenceRef: 'observed-week-2026-10-04:rice-pack',
      },
    ],
  })

  assert.equal(result.status, 'complete')
  assert.equal(result.fullyAttributed, true)
  assert.equal(result.comparisonDeltaCents, -90)
  assert.deepEqual(result.effectTotals, {
    packSizeCents: -10,
    offerCents: -80,
    planningCents: 0,
    unknownCents: 0,
  })
  assert.deepEqual(result.reasons, [])
})

test('M3 attribution preserves an explicit unknown remainder instead of inventing a cause', () => {
  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      {
        lineId: 'tomato',
        effect: 'offer',
        deltaCents: -80,
        evidenceRef: 'observed-week-2026-10-04:tomato-offer',
      },
    ],
  })

  assert.equal(result.status, 'partial')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.offerCents, -80)
  assert.equal(result.effectTotals.unknownCents, -10)
  assert.match(result.reasons.join(' '), /remain unattributed/)
})

test('M3 attribution rejects a non-zero planning effect inside a same-demand store comparison', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      baselineTotalCents: 1000,
      candidateTotalCents: 950,
      deltaCents: -50,
      savingsCents: 50,
      lineDeltas: [
        {
          id: 'planned-leftovers',
          ingredientLabel: 'Planned leftovers',
          baselineLineTotalCents: 250,
          candidateLineTotalCents: 200,
          deltaCents: -50,
        },
      ],
    }),
    evidence: [
      {
        lineId: 'planned-leftovers',
        effect: 'planning',
        deltaCents: -50,
        evidenceRef: 'observed-week-2026-10-04:reuse-measurement',
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.planningCents, 0)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(
    result.reasons.join(' '),
    /planning attribution must be zero for same-demand basket comparisons/,
  )
})

test('M3 attribution rejects duplicate evidence items instead of double-counting them', () => {
  const duplicate = {
    lineId: 'tomato',
    effect: 'offer',
    deltaCents: -60,
    evidenceRef: 'observed-week-2026-10-04:tomato-offer',
  }

  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      duplicate,
      { ...duplicate },
      {
        lineId: 'rice',
        effect: 'pack-size',
        deltaCents: 30,
        evidenceRef: 'observed-week-2026-10-04:rice-pack',
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /duplicate attribution evidence for tomato/)
})

test('M3 attribution rejects unsafe integer cent evidence', () => {
  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      {
        lineId: 'tomato',
        effect: 'offer',
        deltaCents: Number.MAX_SAFE_INTEGER + 1,
        evidenceRef: 'unsafe-integer-evidence',
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /safe integer cents/)
})

test('M3 attribution fails closed when evidence over-attributes a line', () => {
  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      {
        lineId: 'tomato',
        effect: 'offer',
        deltaCents: -130,
        evidenceRef: 'bad-evidence',
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /exceeds line delta/)
})

test('M3 attribution refuses to decompose an unclaimable basket comparison', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      outcome: 'unknown',
      claimable: false,
      deltaCents: null,
      savingsCents: null,
      lineDeltas: [],
      reasons: ['candidate basket has unresolved ingredients: garam'],
    }),
    evidence: [],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.comparisonDeltaCents, null)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /not claimable/)
  assert.match(result.reasons.join(' '), /unresolved ingredients/)
})


test('M3 attribution rejects malformed JSON evidence without throwing', () => {
  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      null,
      {
        lineId: 'tomato',
        effect: 'mystery-effect',
        deltaCents: -120,
        evidenceRef: 'synthetic:bad-effect',
      },
      {
        lineId: 'rice',
        effect: 'offer',
        deltaCents: 30,
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /must be an object/)
  assert.match(result.reasons.join(' '), /unsupported effect/)
  assert.match(result.reasons.join(' '), /missing an evidence reference/)
})
