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
  assert.equal(normalizeMoneyToCents('€ 1.234,56'), 123456)
  assert.equal(normalizeMoneyToCents(''), null)
  assert.equal(normalizeMoneyToCents('n/a'), null)
})

test('malformed money text fails closed instead of being rewritten into another amount', () => {
  for (const input of [
    '1 2,34',
    '12,3 4',
    '1.2,34',
    '12.34,56',
    '1,2,3',
    '+1.00',
    '1.234',
  ]) {
    assert.equal(normalizeMoneyToCents(input), null, input)
  }
})

test('normalizers fail closed on malformed runtime value types', () => {
  for (const input of [null, undefined, 42, {}, []]) {
    assert.equal(normalizeMoneyToCents(input), null)
    assert.deepEqual(normalizePackText(input), {
      rawText: null,
      count: 1,
      amount: null,
      unit: 'unknown',
    })
    assert.deepEqual(normalizeOfferLabel(input), {
      type: 'unknown',
      rawLabel: '',
    })
  }
})

test('normalizes representative AH, PLUS and DekaMarkt pack strings', () => {
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
  assert.deepEqual(normalizePackText('1 kg (ca. 5 stuks)'), {
    rawText: '1 kg (ca. 5 stuks)',
    count: 1,
    amount: 1,
    unit: 'kg',
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

test('ambiguous trailing pack text fails closed instead of accepting a parsed prefix', () => {
  for (const input of [
    '500 g voordeel',
    '500 g x 2',
    '6 x 1 l aanbieding',
    '1 kg (ca. vijf stuks)',
  ]) {
    assert.deepEqual(normalizePackText(input), {
      rawText: input,
      count: 1,
      amount: null,
      unit: 'unknown',
    })
  }
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

test('precision-rounded percentages above 100 percent fail closed', () => {
  for (const label of [
    '100.0000000000000000001% korting',
    '100,0000000000000000001% korting',
    '100.000000000000000001% korting',
    '101.0000000000000000001% korting',
  ]) {
    assert.deepEqual(normalizeOfferLabel(label), {
      type: 'unknown',
      rawLabel: label,
    })
  }

  for (const [label, percent] of [
    ['100% korting', 100],
    ['100.0% korting', 100],
    ['100,000% korting', 100],
    ['99.999999999999999999% korting', 100],
    ['0.5% korting', 0.5],
  ]) {
    assert.deepEqual(normalizeOfferLabel(label), {
      type: 'percent_discount',
      percent,
    })
  }
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

test('invalid zero-sized pack text fails closed instead of producing structured quantity', () => {
  for (const input of ['0 g', '0 x 1 l', '6 x 0 ml']) {
    assert.deepEqual(normalizePackText(input), {
      rawText: input,
      count: 1,
      amount: null,
      unit: 'unknown',
    })
  }
})

test('unsafe numeric normalization inputs fail closed before precision can be lost', () => {
  assert.equal(normalizeMoneyToCents('90071992547409.92'), null)

  for (const input of [
    '9007199254740992 g',
    '9007199254740992 x 1 g',
    '1 x 9007199254740992 ml',
  ]) {
    assert.deepEqual(normalizePackText(input), {
      rawText: input,
      count: 1,
      amount: null,
      unit: 'unknown',
    })
  }

  for (const label of [
    '9007199254740992+1 gratis',
    '1+9007199254740992 gratis',
    '9007199254740992 voor 5.00',
    'voor 90071992547409.92',
  ]) {
    assert.deepEqual(normalizeOfferLabel(label), {
      type: 'unknown',
      rawLabel: label,
    })
  }
})
