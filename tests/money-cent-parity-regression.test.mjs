import assert from 'node:assert/strict'
import test from 'node:test'
import { euro } from '../src/lib/money.ts'

test('cent formatter agrees for safe integer number and bigint representations', () => {
  for (const cents of [-1000001, -101, -100, -99, -1, 0, 1, 99, 100, 101, 1000001]) {
    assert.equal(euro.formatCents(cents), euro.formatCents(BigInt(cents)), `cents=${cents}`)
  }
})

test('euro amount and integer-cent renderings agree on exact amounts', () => {
  for (const cents of [-10001, -101, -1, 0, 1, 101, 10001]) {
    assert.equal(euro.format(cents / 100), euro.formatCents(cents), `cents=${cents}`)
  }
})

test('cent formatter never coerces unsafe or fractional numeric cents', () => {
  for (const value of [NaN, Infinity, -Infinity, 0.1, -0.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(euro.formatCents(value), '—')
  }
})

test('bigint cents preserve precision beyond the safe number range', () => {
  const huge = 900719925474099312345678901n
  const formatted = euro.formatCents(huge)
  const negativeFormatted = euro.formatCents(-huge)
  assert.notEqual(formatted, '—')
  assert.notEqual(negativeFormatted, '—')
  assert.match(formatted, /01/)
  assert.notEqual(formatted, negativeFormatted)
})

test('euro amount formatter rejects floating artifacts instead of silently rounding', () => {
  for (const value of [0.1 + 0.2, 1.005, -1.005, 0.001, -0.001, Number.MAX_SAFE_INTEGER]) {
    assert.equal(euro.format(value), '—', `amount=${value}`)
  }
})

test('one-cent boundaries remain signed and distinct', () => {
  assert.notEqual(euro.formatCents(-1), euro.formatCents(0))
  assert.notEqual(euro.formatCents(0), euro.formatCents(1))
  assert.equal(euro.formatCents(1n), euro.format(0.01))
  assert.equal(euro.formatCents(-1n), euro.format(-0.01))
})
