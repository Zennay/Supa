import assert from 'node:assert/strict'
import test from 'node:test'

import {
  basketComparisonCanShowMoney,
  basketComparisonHeadline,
  comparisonLineHighlights,
} from '../src/features/basket/basketPresentation.ts'

const candidate = { store: { id: 'candidate', name: 'Kandidaatwinkel' } }

function validComparison() {
  return {
    outcome: 'better',
    claimable: true,
    baselineTotalCents: 550,
    candidateTotalCents: 450,
    deltaCents: -100,
    savingsCents: 100,
    lineDeltas: [
      {
        id: 'rice', ingredientLabel: 'Rijst',
        baselineLineTotalCents: 300,
        candidateLineTotalCents: 150,
        deltaCents: -150,
      },
      {
        id: 'tomato', ingredientLabel: 'Tomaat',
        baselineLineTotalCents: 250,
        candidateLineTotalCents: 300,
        deltaCents: 50,
      },
    ],
    reasons: [],
  }
}

test('M3 presentation retains a fully reconciled mixed-direction comparison', () => {
  const comparison = validComparison()
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), true)
  assert.match(basketComparisonHeadline(comparison, candidate), /1,00 lager/)
  assert.deepEqual(comparisonLineHighlights(comparison).map((line) => line.direction), [
    'lower', 'higher',
  ])
})

test('M3 comparison line totals must agree before money can be presented', async (t) => {
  const malformed = [
    ['missing line array', (c) => { c.lineDeltas = undefined }],
    ['invalid line array container', (c) => { c.lineDeltas = {} }],
    ['missing lines with nonzero basket delta', (c) => { c.lineDeltas = [] }],
    ['invalid line object', (c) => { c.lineDeltas[0] = null }],
    ['missing line identity', (c) => { c.lineDeltas[0].id = '' }],
    ['padded line identity', (c) => { c.lineDeltas[0].id = ' rice' }],
    ['duplicate line identity', (c) => { c.lineDeltas[1].id = 'rice' }],
    ['noninteger baseline line cents', (c) => { c.lineDeltas[0].baselineLineTotalCents = 300.5 }],
    ['negative candidate line cents', (c) => { c.lineDeltas[0].candidateLineTotalCents = -1 }],
    ['unsafe line cents', (c) => { c.lineDeltas[0].candidateLineTotalCents = Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong signed line delta', (c) => { c.lineDeltas[0].deltaCents = -149 }],
    ['line baseline total below basket baseline', (c) => {
      c.lineDeltas[0].baselineLineTotalCents = 299
      c.lineDeltas[0].deltaCents = -149
    }],
    ['line candidate total below basket candidate', (c) => {
      c.lineDeltas[0].candidateLineTotalCents = 149
      c.lineDeltas[0].deltaCents = -151
    }],
    ['missing line label', (c) => { c.lineDeltas[0].ingredientLabel = '' }],
  ]

  for (const [label, mutate] of malformed) {
    await t.test(label, () => {
      const comparison = validComparison()
      mutate(comparison)
      assert.equal(basketComparisonCanShowMoney(comparison, candidate), false)
      assert.equal(
        basketComparisonHeadline(comparison, candidate),
        'Nog geen betrouwbare vergelijking',
      )
    })
  }
})

test('M3 presentation supports an exact zero-savings equal-cost basket', () => {
  const comparison = validComparison()
  comparison.outcome = 'same'
  comparison.candidateTotalCents = comparison.baselineTotalCents
  comparison.deltaCents = 0
  comparison.savingsCents = 0
  comparison.lineDeltas[1].candidateLineTotalCents = 400
  comparison.lineDeltas[1].deltaCents = 150
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), true)
  assert.equal(basketComparisonHeadline(comparison, candidate), 'Beide testmanden zijn even duur')
})

test('M3 presentation refuses unsafe aggregate despite individually safe cents', () => {
  const comparison = validComparison()
  comparison.baselineTotalCents = Number.MAX_SAFE_INTEGER
  comparison.candidateTotalCents = Number.MAX_SAFE_INTEGER - 100
  comparison.lineDeltas[0].baselineLineTotalCents = Number.MAX_SAFE_INTEGER
  comparison.lineDeltas[0].candidateLineTotalCents = Number.MAX_SAFE_INTEGER - 100
  comparison.lineDeltas[0].deltaCents = -100
  comparison.lineDeltas[1].baselineLineTotalCents = 0
  comparison.lineDeltas[1].candidateLineTotalCents = 0
  comparison.lineDeltas[1].deltaCents = 0
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), true)

  comparison.lineDeltas[1].baselineLineTotalCents = Number.MAX_SAFE_INTEGER
  comparison.lineDeltas[1].candidateLineTotalCents = Number.MAX_SAFE_INTEGER
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), false)
})
