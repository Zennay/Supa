import assert from 'node:assert/strict'
import test from 'node:test'
import { euro } from '../src/lib/money.ts'

test('shopping prices preserve cents for a full common basket-price range', () => {
  for (let cents = -10000; cents <= 10000; cents++) {
    assert.equal(euro.formatCents(cents), euro.formatCents(BigInt(cents)))
    assert.equal(euro.format(cents / 100), euro.formatCents(cents))
  }
})

test('large safe cent integers preserve number and bigint parity', () => {
  for (const cents of [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(euro.formatCents(cents), euro.formatCents(BigInt(cents)))
  }
})
