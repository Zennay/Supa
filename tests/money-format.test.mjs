import assert from 'node:assert/strict'
import test from 'node:test'

import { euro } from '../src/lib/money.ts'

test('euro formatting preserves finite values', () => {
  assert.match(euro.format(12.34), /12,34/)
  assert.doesNotMatch(euro.format(12.34), /NaN|∞/)
})

test('euro formatting fails closed on non-finite numbers', () => {
  assert.equal(euro.format(Number.NaN), '—')
  assert.equal(euro.format(Number.POSITIVE_INFINITY), '—')
  assert.equal(euro.format(Number.NEGATIVE_INFINITY), '—')
})
