import assert from 'node:assert/strict'
import test from 'node:test'

// Tiny test-only UTC nanosecond oracle, independent of SUPA's millisecond
// Date.parse reporting path. This is *not* a production parser or a proposed
// unreviewed source replacement. It establishes ground-truth elapsed time for
// the negative 24h+1ns controls in issue #1513.
const NS_PER_MILLISECOND = 1_000_000n
const NS_PER_DAY = 24n * 60n * 60n * 1_000_000_000n

function canonicalInstantNanoseconds(text) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text)
  assert.ok(match, 'fixture uses supported ISO second/fraction/offset shape')
  const millisecondAlignedUTC = Date.parse(`${match[1]}.000${match[3]}`)
  assert.ok(Number.isFinite(millisecondAlignedUTC), 'fixture timestamp is representable')
  return BigInt(millisecondAlignedUTC) * NS_PER_MILLISECOND +
    BigInt((match[2] ?? '').padEnd(9, '0'))
}

function exactWindowNanoseconds(a, b) {
  const delta = canonicalInstantNanoseconds(b) - canonicalInstantNanoseconds(a)
  return delta < 0n ? -delta : delta
}

test('M3 oracle proves +1ns is outside exactly 24h even though Date.parse loses the difference', () => {
  const a = '2026-10-24T16:00:00.000000000Z'
  const b = '2026-10-25T16:00:00.000000001Z'
  assert.equal(exactWindowNanoseconds(a, b), NS_PER_DAY + 1n)
  assert.equal(exactWindowNanoseconds(b, a), NS_PER_DAY + 1n)
  assert.equal(Date.parse(b) - Date.parse(a), 24 * 60 * 60 * 1000)
})

test('M3 oracle keeps DST-offset equivalence and detects +1ns precisely', () => {
  const a = '2026-10-24T18:00:00.000000000+02:00'
  const b = '2026-10-25T17:00:00.000000001+01:00'
  const exactlyAtBoundary = '2026-10-25T17:00:00.000000000+01:00'
  assert.equal(exactWindowNanoseconds(a, b), NS_PER_DAY + 1n)
  assert.equal(exactWindowNanoseconds(a, exactlyAtBoundary), NS_PER_DAY)
  assert.equal(canonicalInstantNanoseconds(a), canonicalInstantNanoseconds('2026-10-24T16:00:00Z'))
})

test('M3 oracle distinguishes supported within/exact/over millisecond boundaries', () => {
  const a = '2026-10-24T16:00:00.000Z'
  for (const [candidate, delta] of [
    ['2026-10-25T15:59:59.999Z', NS_PER_DAY - NS_PER_MILLISECOND],
    ['2026-10-25T16:00:00.000Z', NS_PER_DAY],
    ['2026-10-25T16:00:00.001Z', NS_PER_DAY + NS_PER_MILLISECOND],
    ['2026-10-25T16:00:00.000000001Z', NS_PER_DAY + 1n],
  ]) {
    assert.equal(exactWindowNanoseconds(a, candidate), delta)
  }
})
