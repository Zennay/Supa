import assert from 'node:assert/strict'
import test from 'node:test'

import { euro, savings } from '../src/lib/money.ts'

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

test('savings rejects malformed money inputs', () => {
  assert.equal(savings(Number.NaN, 10), null)
  assert.equal(savings(10, Number.NaN), null)
  assert.equal(savings(Number.POSITIVE_INFINITY, 10), null)
  assert.equal(savings(10, Number.NEGATIVE_INFINITY), null)
  assert.equal(savings(-1, 10), null)
  assert.equal(savings(10, -1), null)
  assert.equal(savings(-1, -5), null)
})

test('savings rejects malformed runtime value types without coercion', () => {
  for (const malformed of [null, undefined, '10', {}, [], true]) {
    assert.equal(savings(malformed, 10), null)
    assert.equal(savings(10, malformed), null)
  }
})

test('savings rejects values beyond the exact cent-safe euro magnitude', () => {
  const safeMagnitude = Number.MAX_SAFE_INTEGER / 100
  const unsafeMagnitude = safeMagnitude + 1

  assert.equal(savings(unsafeMagnitude, 10), null)
  assert.equal(savings(10, unsafeMagnitude), null)
  assert.equal(savings(-unsafeMagnitude, 10), null)
})

test('savings rejects sub-cent inputs instead of rounding them', () => {
  assert.equal(savings(12.345, 10), null)
  assert.equal(savings(10, 1.001), null)
  assert.equal(savings(0.30000000000000004, 0.1), null)
})

test('savings computes through safe integer cents', () => {
  assert.equal(savings(40, 31.8), 8.2)
  assert.equal(savings(31.8, 40), 0)
  assert.equal(savings(0.3, 0.1), 0.2)
})
