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

test('cent-native formatting preserves safe integer cents without float conversion', () => {
  const cents = 9_007_199_253_740_993

  assert.notEqual(Math.round((cents / 100) * 100), cents)
  assert.equal(euro.formatCents(cents), euro.formatCents(BigInt(cents)))
  assert.match(euro.formatCents(cents), /,93$/)
})

test('cent-native formatting preserves sub-euro and negative cent values', () => {
  assert.match(euro.formatCents(23), /0,23$/)
  assert.match(euro.formatCents(-23), /-0,23$/)
  assert.match(euro.formatCents(1234), /12,34$/)
  assert.match(euro.formatCents(-1234), /-12,34$/)
})

test('cent-native formatting rejects malformed numeric cent values', () => {
  for (const malformed of [12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(euro.formatCents(malformed), '—', String(malformed))
  }

  for (const malformed of [null, undefined, '1234', {}, []]) {
    assert.equal(euro.formatCents(malformed), '—')
  }
})

test('cent-native formatting preserves bigint cents outside Number range', () => {
  const cents = BigInt(Number.MAX_SAFE_INTEGER) * 100n + 42n

  assert.match(euro.formatCents(cents), /,42$/)
})

test('numeric euro formatting stays aligned with exact cent presentation', () => {
  for (const value of [0, 0.29, 12.34, -12.34, 31.8]) {
    assert.equal(euro.format(value), euro.formatCents(Math.round(value * 100)))
  }
})
