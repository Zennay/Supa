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

test('M3 attribution rejects blank comparison line identities before evidence lookup', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      baselineTotalCents: 100,
      candidateTotalCents: 100,
      deltaCents: 0,
      savingsCents: 0,
      lineDeltas: [
        {
          id: '   ',
          ingredientLabel: 'Unknown ingredient',
          baselineLineTotalCents: 100,
          candidateLineTotalCents: 100,
          deltaCents: 0,
        },
      ],
    }),
    evidence: [],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /invalid line identity/)
})

test('M3 attribution rejects duplicate comparison line identities instead of reusing evidence twice', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      deltaCents: -90,
      savingsCents: 90,
      lineDeltas: [
        {
          id: 'tomato',
          ingredientLabel: 'Tomato first',
          baselineLineTotalCents: 300,
          candidateLineTotalCents: 255,
          deltaCents: -45,
        },
        {
          id: 'tomato',
          ingredientLabel: 'Tomato duplicate',
          baselineLineTotalCents: 300,
          candidateLineTotalCents: 255,
          deltaCents: -45,
        },
      ],
    }),
    evidence: [
      {
        lineId: 'tomato',
        effect: 'offer',
        deltaCents: -45,
        evidenceRef: 'observed-week-2026-10-04:tomato-offer',
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /duplicate line identity tomato/)
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


test('M3 attribution rejects padded comparison line identities', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      lineDeltas: [
        {
          id: 'tomato',
          ingredientLabel: 'Tomato',
          baselineLineTotalCents: 500,
          candidateLineTotalCents: 380,
          deltaCents: -120,
        },
        {
          id: 'rice ',
          ingredientLabel: 'Rice',
          baselineLineTotalCents: 400,
          candidateLineTotalCents: 430,
          deltaCents: 30,
        },
      ],
    }),
    evidence: [],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /invalid line identity/)
})

test('M3 attribution rejects padded evidence line identities', () => {
  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      {
        lineId: 'tomato ',
        effect: 'offer',
        deltaCents: -120,
        evidenceRef: 'observed-week-2026-10-04:tomato-offer',
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /canonical non-empty string/)
})

test('M3 attribution rejects padded evidence references', () => {
  const result = attributeSavingsEffects({
    comparison: comparison(),
    evidence: [
      {
        lineId: 'tomato',
        effect: 'offer',
        deltaCents: -120,
        evidenceRef: ' observed-week-2026-10-04:tomato-offer',
      },
    ],
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.fullyAttributed, false)
  assert.equal(result.effectTotals.unknownCents, null)
  assert.match(result.reasons.join(' '), /canonical evidence reference/)
})

test('M3 attribution rejects malformed top-level evidence without throwing or fabricating effects', () => {
  for (const evidence of [null, undefined, {}, 'not-an-evidence-array', 42, true]) {
    const result = attributeSavingsEffects({
      comparison: comparison(),
      evidence,
    })
    assert.equal(result.status, 'unknown')
    assert.equal(result.fullyAttributed, false)
    assert.equal(result.comparisonDeltaCents, -90)
    assert.deepEqual(result.effectTotals, {
      packSizeCents: 0,
      offerCents: 0,
      planningCents: 0,
      unknownCents: null,
    })
    assert.deepEqual(result.reasons, ['attribution evidence must be an array'])
  }
})

test('M3 attribution continues to preserve unclaimable comparison before parsing malformed evidence', () => {
  const result = attributeSavingsEffects({
    comparison: comparison({
      claimable: false,
      outcome: 'unknown',
      deltaCents: null,
      savingsCents: null,
      lineDeltas: [],
      reasons: ['candidate basket unresolved'],
    }),
    evidence: null,
  })

  assert.equal(result.status, 'unknown')
  assert.equal(result.comparisonDeltaCents, null)
  assert.match(result.reasons.join(' '), /candidate basket unresolved/)
  assert.doesNotMatch(result.reasons.join(' '), /evidence must be an array/)
})
