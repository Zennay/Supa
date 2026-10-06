import assert from 'node:assert/strict'
import test from 'node:test'

import { euro, savings } from '../src/lib/money.ts'

test('euro formatting preserves finite values', () => {
  assert.match(euro.format(12.34), /12,34/)
  assert.doesNotMatch(euro.format(12.34), /NaN|∞/)
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

test('euro formatting preserves bigint values', () => {
  assert.match(euro.format(1234n), /1\.234/)
})

test('euro formatting fails closed on non-finite numbers', () => {
  assert.equal(euro.format(Number.NaN), '—')
  assert.equal(euro.format(Number.POSITIVE_INFINITY), '—')
  assert.equal(euro.format(Number.NEGATIVE_INFINITY), '—')
})

test('savings rejects malformed money inputs', () => {
  assert.equal(savings(Number.NaN, 10), null)
  assert.equal(savings(10, Number.NaN), null)
  assert.equal(savings(Number.POSITIVE_INFINITY, 10), null)
  assert.equal(savings(10, Number.NEGATIVE_INFINITY), null)
  assert.equal(savings(-1, 10), null)
  assert.equal(savings(10, -1), null)
  assert.equal(savings(-1, -5), null)
})

test('savings preserves its positive-only finite contract', () => {
  assert.equal(savings(40, 31.8), 8.2)
  assert.equal(savings(31.8, 40), 0)
})
