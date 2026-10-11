import assert from 'node:assert/strict'
import test from 'node:test'

import { euro } from '../src/lib/money.ts'

// Synthetic product display contract: a displayed monetary amount must not
// silently discard cent precision, even beyond JavaScript's safe number range.
// These cases do not represent observed supermarket prices or M3 savings.
test('euro and cent-native entry points agree for ordinary exact signed cents', () => {
  for (const cents of [
    -100_001, -10_099, -1_001, -101, -100, -99, -1,
    0, 1, 9, 10, 99, 100, 101, 1_001, 10_099, 100_001,
  ]) {
    const euros = cents / 100
    assert.equal(
      euro.format(euros),
      euro.formatCents(cents),
      `inconsistent product money disclosure for ${cents} cents`,
    )
  }
})

test('formatted bigint cents preserve both last digits beyond safe integer range', () => {
  const largeWholeEuros = 10n ** 33n
  for (const remainder of [1n, 9n, 10n, 19n, 42n, 90n, 99n]) {
    const positive = euro.formatCents(largeWholeEuros * 100n + remainder)
    const negative = euro.formatCents(-(largeWholeEuros * 100n + remainder))
    const expectedFraction = `,${remainder.toString().padStart(2, '0')}`
    assert.ok(positive.endsWith(expectedFraction), `positive ${remainder}: ${positive}`)
    assert.ok(negative.endsWith(expectedFraction), `negative ${remainder}: ${negative}`)
    assert.notEqual(positive, negative)
    assert.ok(positive.includes('€') && negative.includes('€'))
  }
})

test('numeric cents are rejected instead of rounded when unsafe or fractional', () => {
  for (const cents of [
    0.1, -0.1, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER + 1,
    -(Number.MAX_SAFE_INTEGER + 1), Infinity, -Infinity, NaN,
  ]) {
    assert.equal(euro.formatCents(cents), '—', String(cents))
  }
})

test('invalid numeric euro precision is not silently rounded into a claimed cent', () => {
  for (const euros of [0.001, -0.001, 12.345, -12.345, 1 / 3, NaN, Infinity]) {
    assert.equal(euro.format(euros), '—', String(euros))
  }
  assert.equal(euro.formatCents(29n), euro.format(0.29))
  assert.equal(euro.formatCents(-29n), euro.format(-0.29))
})

test('hostile boxed and revoked runtime inputs do not execute coercion hooks', () => {
  let invoked = 0
  const hostile = {
    valueOf() { invoked++; throw new Error('do not evaluate') },
    toString() { invoked++; throw new Error('do not evaluate') },
  }
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  for (const input of [hostile, new Number(123), proxy, null, undefined, '0.29']) {
    assert.equal(euro.format(input), '—')
    assert.equal(euro.formatCents(input), '—')
  }
  assert.equal(invoked, 0)
})
