import assert from 'node:assert/strict'
import test from 'node:test'
import { euro } from '../src/lib/money.ts'

const dutchCurrency = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

test('basket euro labels match Dutch currency presentation at representative price boundaries', () => {
  for (const cents of [-123456, -100001, -99999, -101, -100, -99, -1, 0, 1, 99, 100, 101, 99999, 100001, 123456]) {
    assert.equal(euro.formatCents(cents), dutchCurrency.format(cents / 100))
  }
})

test('basket euro labels reject non-cent monetary amounts instead of rounding a claim', () => {
  for (const value of [0.001, -0.001, 1.005, -1.005, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(euro.format(value), '—')
  }
})
