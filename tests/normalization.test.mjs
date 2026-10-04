import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeMoneyToCents,
  normalizeOfferLabel,
  normalizePackText,
} from '../src/data/normalize.ts'

test('normalizes Dutch and dot-decimal prices into integer cents', () => {
  assert.equal(normalizeMoneyToCents('€ 1,29'), 129)
  assert.equal(normalizeMoneyToCents('0.89'), 89)
  assert.equal(normalizeMoneyToCents('2,49'), 249)
  assert.equal(normalizeMoneyToCents(''), null)
  assert.equal(normalizeMoneyToCents('n/a'), null)
})

test('normalizes representative AH and PLUS pack strings', () => {
  assert.deepEqual(normalizePackText('1 l'), {
    rawText: '1 l',
    count: 1,
    amount: 1,
    unit: 'l',
  })
  assert.deepEqual(normalizePackText('Per Pak 1000 ml'), {
    rawText: 'Per Pak 1000 ml',
    count: 1,
    amount: 1000,
    unit: 'ml',
  })
  assert.deepEqual(normalizePackText('500 g'), {
    rawText: '500 g',
    count: 1,
    amount: 500,
    unit: 'g',
  })
  assert.deepEqual(normalizePackText('6 x 1 l'), {
    rawText: '6 x 1 l',
    count: 6,
    amount: 1,
    unit: 'l',
  })
})

test('unknown pack text remains explicit instead of guessed', () => {
  assert.deepEqual(normalizePackText('los'), {
    rawText: 'los',
    count: 1,
    amount: null,
    unit: 'unknown',
  })
})

test('normalizes common supermarket offer mechanics without guessing unknown labels', () => {
  assert.deepEqual(normalizeOfferLabel('1+1 gratis'), {
    type: 'buy_x_get_y_free',
    buy: 1,
    free: 1,
  })
  assert.deepEqual(normalizeOfferLabel('2 voor 5.00'), {
    type: 'quantity_for_price',
    quantity: 2,
    totalPriceCents: 500,
  })
  assert.deepEqual(normalizeOfferLabel('30% korting'), {
    type: 'percent_discount',
    percent: 30,
  })
  assert.deepEqual(normalizeOfferLabel('voor 1.19'), {
    type: 'fixed_price',
    priceCents: 119,
  })
  assert.deepEqual(normalizeOfferLabel('2e halve prijs'), {
    type: 'second_half_price',
  })
  assert.deepEqual(normalizeOfferLabel('ACTIE'), {
    type: 'unknown',
    rawLabel: 'ACTIE',
  })
})

test('invalid offer mechanics fail closed instead of entering savings math', () => {
  for (const label of [
    '0+1 gratis',
    '1+0 gratis',
    '0 voor 5.00',
    '2 voor 0.00',
    '0% korting',
    '150% korting',
    'voor 0.00',
  ]) {
    assert.deepEqual(normalizeOfferLabel(label), {
      type: 'unknown',
      rawLabel: label,
    })
  }
})
