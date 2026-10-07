import assert from 'node:assert/strict'
import test from 'node:test'

import { euro } from '../src/lib/money.ts'

test('euro formatting preserves cent-exact finite values', () => {
  for (const value of [0.29, 12.34, 31.8]) {
    assert.notEqual(euro.format(value), '—', String(value))
    assert.doesNotMatch(euro.format(value), /NaN|∞/, String(value))
  }
})

test('euro formatting normalizes signed zero', () => {
  assert.equal(euro.format(-0), euro.format(0))
  assert.notEqual(euro.format(-1), euro.format(1))
})

test('euro formatting rejects malformed runtime value types', () => {
  for (const malformed of [null, undefined, '12.34', {}, []]) {
    assert.equal(euro.format(malformed), '—')
  }
})

test('euro formatting rejects sub-cent numeric values', () => {
  for (const subCent of [12.345, 0.001, 0.30000000000000004]) {
    assert.equal(euro.format(subCent), '—', String(subCent))
  }
})

test('euro formatting preserves bigint values', () => {
  assert.match(euro.format(1234n), /1\.234/)
})

test('euro formatting fails closed on non-finite numbers', () => {
  assert.equal(euro.format(Number.NaN), '—')
  assert.equal(euro.format(Number.POSITIVE_INFINITY), '—')
  assert.equal(euro.format(Number.NEGATIVE_INFINITY), '—')
})
