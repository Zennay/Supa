import assert from 'node:assert/strict'
import test from 'node:test'

import { euro } from '../src/lib/money.ts'

test('euro formatting fails closed beyond the exact cent-safe numeric magnitude', () => {
  const safeBoundary = Number.MAX_SAFE_INTEGER / 100

  assert.notEqual(euro.format(safeBoundary), '—')
  assert.equal(euro.format(Number.MAX_SAFE_INTEGER), '—')
  assert.equal(euro.format(-Number.MAX_SAFE_INTEGER), '—')
})

test('euro formatting keeps exact bigint support outside the number magnitude boundary', () => {
  assert.notEqual(euro.format(BigInt(Number.MAX_SAFE_INTEGER) * 100n), '—')
})
