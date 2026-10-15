import test from 'node:test'
import assert from 'node:assert/strict'
import { assertUnambiguousM3StudyJson } from '../scripts/m3-verify-private-week-preflight.mjs'

// Independent offline QA on a frozen M3 private-study scanner. No retailer I/O,
// human field evidence, prices or permission/public-savings claims.
const parse = (raw) => assertUnambiguousM3StudyJson(raw)
const refuse = (raw) => assert.throws(() => parse(raw), /M3 private study provenance preflight refused/)

test('M3 allows exactly 100k JSON value nodes including root array', () => {
  const within = '[' + new Array(99999).fill('0').join(',') + ']'
  assert.ok(Buffer.byteLength(within) < 4 * 1024 * 1024)
  assert.doesNotThrow(() => parse(within))
})

test('M3 refuses 100001 value nodes even when JSON bytes remain small', () => {
  const beyond = '[' + new Array(100000).fill('0').join(',') + ']'
  assert.ok(Buffer.byteLength(beyond) < 4 * 1024 * 1024)
  refuse(beyond)
})

test('M3 allows exactly 50000 distinct object keys without losing member identity', () => {
  const within = '{' + Array.from({ length: 50000 }, (_, i) => '"q' + i + '":0').join(',') + '}'
  assert.ok(Buffer.byteLength(within) < 4 * 1024 * 1024)
  assert.doesNotThrow(() => parse(within))
})

test('M3 refuses 50001 distinct object keys before doing unbounded work', () => {
  const beyond = '{' + Array.from({ length: 50001 }, (_, i) => '"q' + i + '":0').join(',') + '}'
  assert.ok(Buffer.byteLength(beyond) < 4 * 1024 * 1024)
  refuse(beyond)
})

test('M3 accepts exact JSON numeric exponents, signed zero, booleans and null', () => {
  assert.doesNotThrow(() => parse('[true,false,null,0,-0,1,-19.125,2e3,6.022E+23,2.5e-3]'))
  assert.doesNotThrow(() => parse('{"amount":-0,"price":1e+2,"unit":"fictional"}'))
})

test('M3 rejects invalid numeric tokens rather than accepting valid prefixes', () => {
  for (const invalid of [
    '[truefalse]', '[nullnull]', '[00]', '[01]', '[1e]', '[2E+]',
    '[.5]', '[1.]', '[--1]', '[+1]', '[0x10]', '[NaN]', '[Infinity]',
    '[1 2]', '[falsee]', '{"x":1e4garbage}',
  ]) refuse(invalid)
})

test('M3 bounds array nesting to 80 levels without confusing sibling arrays', () => {
  assert.doesNotThrow(() => parse('['.repeat(80) + 'null' + ']'.repeat(80)))
  refuse('['.repeat(81) + 'null' + ']'.repeat(81))
  assert.doesNotThrow(() => parse('[[0],[1],[2],[3]]'))
})
