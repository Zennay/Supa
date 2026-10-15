import test from 'node:test'
import assert from 'node:assert/strict'
import { assertUnambiguousM3StudyJson } from '../scripts/m3-verify-private-week-preflight.mjs'

// Independent QA-only parser contract, no retailer network, personal records or price evidence.
// The real workflow still requires code-pin, matched 11x2 demand and human provenance.
const refuse = (json) =>
  assert.throws(() => assertUnambiguousM3StudyJson(json), /preflight refused/)

test('strict private M3 parser accepts distinct sibling names, arrays and escaped value strings', () => {
  const original = String.raw`{"baseline":{"id":"plus","info":["literal \"quoted\"","back\\slash",null,true,false,-1.25e+2]},"candidate":{"id":"deka"},"notes":"\u0061"}`
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(original))
  assert.equal(JSON.parse(original).baseline.info.length, 6)
})

test('strict private M3 parser refuses duplicate names within one nested object, not across siblings', () => {
  assert.doesNotThrow(() =>
    assertUnambiguousM3StudyJson('{"baseline":{"id":"a"},"candidate":{"id":"b"}}'))
  refuse('{"baseline":{"store":{"id":"a","id":"b"}}}')
})

test('strict private M3 parser refuses escaped equivalent key names', () => {
  refuse(String.raw`{"store":{"observedAt":"a","observed\u0041t":"b"}}`)
  refuse(String.raw`{"store":{"key":"a","\u006bey":"b"}}`)
})

test('strict private M3 parser permits unambiguous escaped Unicode keys', () => {
  const source = String.raw`{"note":"synthetic","item\u002dcode":"fictional","nested":{"\u00e9":"x"}}`
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(source))
})

test('strict private M3 parser rejects malformed JSON syntax instead of misclassifying text', () => {
  for (const json of [
    '', 'null trailing', '{"a":1,}', '{"a":[1,2,]}',
    '{"a":"unterminated}', '{"a":"a' + String.fromCharCode(1) + 'b"}',
    '{"a":tru}', '{"a":01}', '{"a":[1}]}', '{"a": "x" "b":"y"}',
  ]) refuse(json)
})

test('strict private M3 parser enforces nested input depth and accepts safe sibling arrays', () => {
  // Root array itself is depth 0; an inner primitive at depth 80 is permitted.
  const allowed = '['.repeat(80) + 'null' + ']'.repeat(80)
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(allowed))
  refuse('['.repeat(81) + 'null' + ']'.repeat(81))
  assert.doesNotThrow(() =>
    assertUnambiguousM3StudyJson('[[{"x":"y"}],[{"x":"z"}]]'))
})

test('strict private M3 parser enforces 4MiB byte budget including multi-byte Unicode', () => {
  const near = JSON.stringify({ note: 'z'.repeat(1024 * 1024) })
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(near))
  const oversized = JSON.stringify({ note: 'é'.repeat(2 * 1024 * 1024) })
  assert.ok(Buffer.byteLength(oversized, 'utf8') > 4 * 1024 * 1024)
  refuse(oversized)
})

test('strict private M3 parser bounds total object members without rejecting ordinary fixtures', () => {
  const within = Object.fromEntries(Array.from({ length: 256 }, (_, i) => ['k' + i, String(i)]))
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(JSON.stringify(within)))
  // Use short primitive strings to stay far below the 4MiB byte bound.
  const over = '{"' + Array.from({ length: 50001 }, (_, i) =>
    'k' + i + '":"v"').join(',"') + '}'
  refuse(over)
})
