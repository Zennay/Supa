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
  lineDeltas: [],
  reasons: [],
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
    basketComparisonHeadline({
      ...baseline,
      outcome: 'worse',
      candidateTotalCents: 12875,
      deltaCents: 375,
      savingsCents: -375,
    }, candidate),
    `DekaMarkt ligt ${euro.formatCents(375)} hoger`,
  )
  assert.equal(
    basketComparisonHeadline({
      ...baseline,
      outcome: 'same',
      baselineTotalCents: 12500,
      candidateTotalCents: 12500,
      deltaCents: 0,
      savingsCents: 0,
    }, candidate),
    'Beide testmanden zijn even duur',
  )
  const large = 9_007_199_253_740_993
  assert.equal(
    basketComparisonHeadline({
      ...baseline,
      baselineTotalCents: 0,
      candidateTotalCents: large,
      outcome: 'worse',
      deltaCents: large,
      savingsCents: -large,
    }, candidate),
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
  const same = {
    ...baseline,
    outcome: 'same',
    baselineTotalCents: 1000,
    candidateTotalCents: 1000,
    deltaCents: 0,
    savingsCents: 0,
  }
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
