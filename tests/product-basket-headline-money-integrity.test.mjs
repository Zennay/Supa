import assert from 'node:assert/strict'
import test from 'node:test'

import { euro } from '../src/lib/money.ts'
import { basketComparisonCanShowMoney, basketComparisonHeadline } from '../src/features/basket/basketPresentation.ts'

const baseline = {
  claimable: true,
  outcome: 'better',
  baselineTotalCents: 12500,
  candidateTotalCents: 12250,
  deltaCents: -250,
  savingsCents: 250,
  lineDeltas: [{
    id: 'synthetic',
    ingredientLabel: 'Synthetische mandregel',
    baselineLineTotalCents: 12500,
    candidateLineTotalCents: 12250,
    deltaCents: -250,
  }],
  reasons: [],
}

function comparisonForTotals(baselineTotalCents, candidateTotalCents, outcome) {
  const deltaCents = candidateTotalCents - baselineTotalCents
  return {
    ...baseline,
    outcome,
    baselineTotalCents,
    candidateTotalCents,
    deltaCents,
    savingsCents: -deltaCents,
    lineDeltas: [{
      id: 'synthetic',
      ingredientLabel: 'Synthetische mandregel',
      baselineLineTotalCents: baselineTotalCents,
      candidateLineTotalCents: candidateTotalCents,
      deltaCents,
    }],
  }
}

const candidate = { store: { id: 'store-b', name: 'DekaMarkt' } }
const neutral = 'Nog geen betrouwbare vergelijking'

test('product comparison headline displays only validated exact signed cent differences', () => {
  assert.equal(basketComparisonCanShowMoney(baseline, candidate), true)
  assert.equal(
    basketComparisonHeadline(baseline, candidate),
    `DekaMarkt ligt ${euro.formatCents(250)} lager`,
  )
  assert.equal(
    basketComparisonHeadline(
      comparisonForTotals(12500, 12875, 'worse'), candidate,
    ),
    `DekaMarkt ligt ${euro.formatCents(375)} hoger`,
  )
  assert.equal(
    basketComparisonHeadline(
      comparisonForTotals(12500, 12500, 'same'), candidate,
    ),
    'Beide testmanden zijn even duur',
  )
  const large = 9_007_199_253_740_993
  assert.equal(
    basketComparisonHeadline(
      comparisonForTotals(0, large, 'worse'), candidate,
    ),
    `DekaMarkt ligt ${euro.formatCents(large)} hoger`,
  )
})

test('financial headline abstains on missing, coerced, unsafe or contradictory cents', () => {
  const invalid = [
    { savingsCents: null },
    { savingsCents: undefined },
    { savingsCents: '250' },
    { savingsCents: Number.NaN },
    { savingsCents: Number.POSITIVE_INFINITY },
    { savingsCents: 2.5 },
    { savingsCents: Number.MAX_SAFE_INTEGER + 1 },
    { savingsCents: 0 },
    { savingsCents: -250 },
    { deltaCents: 250 },
    { deltaCents: null },
    { deltaCents: -249 },
    { baselineTotalCents: 12501 },
    { candidateTotalCents: 12249 },
    { claimable: false },
    { outcome: 'unknown' },
    { outcome: 'same' },
    { reasons: ['stale comparison'] },
  ]
  for (const mutation of invalid) {
    assert.equal(basketComparisonCanShowMoney({ ...baseline, ...mutation }, candidate), false)
    assert.equal(
      basketComparisonHeadline({ ...baseline, ...mutation }, candidate),
      neutral,
      JSON.stringify(mutation),
    )
  }

  for (const unusable of [null, {}, { store: null }, { store: { name: '' } }]) {
    assert.equal(basketComparisonCanShowMoney(baseline, unusable), false)
    assert.equal(basketComparisonHeadline(baseline, unusable), neutral)
  }
  assert.equal(basketComparisonHeadline(null, candidate), neutral)
})

test('even a claimed same-price headline needs consistent, complete cent totals', () => {
  const same = comparisonForTotals(1000, 1000, 'same')
  for (const mutation of [
    { baselineTotalCents: Number.NaN },
    { candidateTotalCents: '1000' },
    { candidateTotalCents: -1 },
    { candidateTotalCents: 1001 },
    { savingsCents: 1 },
    { deltaCents: -1 },
    { claimable: false },
  ]) {
    assert.equal(basketComparisonHeadline({ ...same, ...mutation }, candidate), neutral)
  }
})
