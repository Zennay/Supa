import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeMoneyToCents,
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
