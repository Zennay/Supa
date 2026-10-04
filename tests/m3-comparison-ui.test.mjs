import assert from 'node:assert/strict'
import test from 'node:test'

import { presentBasketComparison } from '../src/features/basket/comparisonPresentation.ts'

function comparison(overrides = {}) {
  return {
    baselineStoreId: 'a',
    candidateStoreId: 'b',
    selectedMealCount: 4,
    baselineMatchedSubtotalCents: 3147,
    candidateMatchedSubtotalCents: 3077,
    deltaCents: 70,
    savingsRate: 70 / 3147,
    direction: 'cheaper',
    claimable: true,
    reasons: [],
    effects: {
      packSizeCents: null,
      offerCents: null,
      planningCents: null,
      unexplainedCents: 70,
    },
    ...overrides,
  }
}

test('M3 product copy describes a cheaper controlled basket without claiming observed savings', () => {
  const result = presentBasketComparison(
    comparison(),
    'Testwinkel A',
    'Testwinkel B',
  )

  assert.equal(result.status, 'claimable')
  assert.match(result.title, /Testwinkel B is lager/)
  assert.equal(result.deltaLabel, '€ 0,70 lager')
  assert.match(result.detail, /rekenbewijs, geen waargenomen besparing/)
})

test('M3 product copy preserves a worse comparison visibly', () => {
  const result = presentBasketComparison(
    comparison({
      candidateMatchedSubtotalCents: 4077,
      deltaCents: -930,
      savingsRate: -930 / 3147,
      direction: 'worse',
      effects: {
        packSizeCents: null,
        offerCents: null,
        planningCents: null,
        unexplainedCents: -930,
      },
    }),
    'Testwinkel A',
    'Testwinkel B',
  )

  assert.equal(result.status, 'claimable')
  assert.match(result.title, /Testwinkel B is hoger/)
  assert.equal(result.deltaLabel, '€ 9,30 hoger')
  assert.match(result.detail, /negatieve uitkomsten/)
})

test('M3 product copy suppresses money when comparison is unknown', () => {
  const result = presentBasketComparison(
    comparison({
      deltaCents: null,
      savingsRate: null,
      direction: 'unknown',
      claimable: false,
      reasons: ['candidate unresolved ingredient: garam-masala'],
      effects: {
        packSizeCents: null,
        offerCents: null,
        planningCents: null,
        unexplainedCents: null,
      },
    }),
    'Testwinkel A',
    'Testwinkel B',
  )

  assert.equal(result.status, 'unknown')
  assert.equal(result.deltaLabel, 'Geen financieel verschil getoond')
  assert.match(result.detail, /unresolved ingredient/)
  assert.doesNotMatch(result.title, /besparing/i)
})

test('M3 product copy presents equal controlled baskets neutrally', () => {
  const result = presentBasketComparison(
    comparison({
      candidateMatchedSubtotalCents: 3147,
      deltaCents: 0,
      savingsRate: 0,
      direction: 'same',
      effects: {
        packSizeCents: null,
        offerCents: null,
        planningCents: null,
        unexplainedCents: 0,
      },
    }),
    'Testwinkel A',
    'Testwinkel B',
  )

  assert.match(result.title, /even duur/)
  assert.equal(result.deltaLabel, '€ 0,00 verschil')
})
