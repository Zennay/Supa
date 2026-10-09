import assert from 'node:assert/strict'
import test from 'node:test'

import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'

// Synthetic test-only breakdown; never an observed price or a public savings claim.
const comparison = {
  outcome: 'better',
  claimable: true,
  baselineTotalCents: 3000,
  candidateTotalCents: 2910,
  deltaCents: -90,
  savingsCents: 90,
  reasons: [],
  lineDeltas: [
    {
      id: 'tomatoes',
      ingredientLabel: 'Tomatoes',
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
    {
      id: 'salt',
      ingredientLabel: 'Salt',
      baselineLineTotalCents: 250,
      candidateLineTotalCents: 250,
      deltaCents: 0,
    },
  ],
}

const evidence = [
  { lineId: 'tomatoes', effect: 'offer', deltaCents: -80, evidenceRef: 'synthetic:offer-a' },
  { lineId: 'tomatoes', effect: 'pack-size', deltaCents: -40, evidenceRef: 'synthetic:pack-a' },
  { lineId: 'rice', effect: 'pack-size', deltaCents: 30, evidenceRef: 'synthetic:pack-b' },
]

function permutations(values) {
  if (values.length === 0) return [[]]
  return values.flatMap((value, index) =>
    permutations(values.filter((_, current) => current !== index)).map(
      (tail) => [value, ...tail],
    ),
  )
}

test('M3 per-effect accounting stays exactly the same regardless of evidence input order', () => {
  const canonical = attributeSavingsEffects({ comparison, evidence })
  assert.equal(canonical.status, 'complete')
  assert.equal(canonical.fullyAttributed, true)
  assert.deepEqual(canonical.effectTotals, {
    packSizeCents: -10,
    offerCents: -80,
    planningCents: 0,
    unknownCents: 0,
  })

  for (const permutation of permutations(evidence)) {
    const result = attributeSavingsEffects({ comparison, evidence: permutation })
    assert.deepEqual(result, canonical)
    assert.equal(
      result.effectTotals.packSizeCents +
        result.effectTotals.offerCents +
        result.effectTotals.planningCents +
        result.effectTotals.unknownCents,
      comparison.deltaCents,
    )
  }
})

test('M3 splitting one evidenced effect into separately referenced parts does not manufacture new savings', () => {
  const split = [
    { ...evidence[0], deltaCents: -50, evidenceRef: 'synthetic:offer-a-first' },
    { ...evidence[0], deltaCents: -30, evidenceRef: 'synthetic:offer-a-second' },
    ...evidence.slice(1),
  ]
  const canonical = attributeSavingsEffects({ comparison, evidence })
  assert.equal(canonical.status, 'complete')

  for (const permutation of permutations(split)) {
    const result = attributeSavingsEffects({ comparison, evidence: permutation })
    assert.equal(result.status, 'complete')
    assert.equal(result.fullyAttributed, true)
    assert.deepEqual(result.effectTotals, canonical.effectTotals)
    assert.equal(result.comparisonDeltaCents, comparison.deltaCents)
  }
})

test('M3 partial attribution exposes the missing per-line amount in any evidence order', () => {
  const partial = evidence.filter((item) => item.evidenceRef !== 'synthetic:pack-a')
  const canonical = attributeSavingsEffects({ comparison, evidence: partial })
  assert.equal(canonical.status, 'partial')
  assert.equal(canonical.fullyAttributed, false)
  assert.deepEqual(canonical.effectTotals, {
    packSizeCents: 30,
    offerCents: -80,
    planningCents: 0,
    unknownCents: -40,
  })

  for (const permutation of permutations(partial)) {
    const result = attributeSavingsEffects({ comparison, evidence: permutation })
    assert.deepEqual(result, canonical)
    assert.equal(
      result.effectTotals.packSizeCents +
        result.effectTotals.offerCents +
        result.effectTotals.planningCents +
        result.effectTotals.unknownCents,
      comparison.deltaCents,
    )
  }
})
