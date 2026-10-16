import test from 'node:test'
import assert from 'node:assert/strict'
import { readAuthorizedHtmlScriptEvidence } from '../scripts/retailer-approved-html-script-evidence.mjs'

// Independent quality-validation: JSON string escape semantics are structural,
// not a spelling heuristic. In-memory synthetic bytes, no retail HTTP or prices.
const jsonLd = raw => '<script type="application/ld+json">' + raw + '</script>'
const nuxt = raw => '<script id="__NUXT_DATA__" type="application/json">' + raw + '</script>'
const read = raw => readAuthorizedHtmlScriptEvidence(jsonLd(raw))

for (const [name, source] of [
  ['Unicode-escaped Product.url', String.raw`{"url":"https://approved.example.test/a","\u0075rl":"https://wrong.example.test/b"}`],
  ['Unicode-escaped nested Offer.price', String.raw`{"offers":{"price":"2.49","\u0070rice":"0.01"}}`],
  ['JSON-escaped forward slash in a property name', String.raw`{"a/b":1,"a\/b":2}`],
  ['escaped quote in a property name', String.raw`{"a\"b":1,"a\u0022b":2}`],
  ['UTF-16 surrogate sequence equal to literal astral character', String.raw`{"\uD83D\uDE00":1,"😀":2}`],
]) {
  test('reject truly duplicate decoded JSON-LD key: ' + name, () => {
    const decoded = JSON.parse(source)
    // Verify this fixture really contains a collision after JSON decoding.
    // JSON.parse retains the last duplicate object property, proving why the
    // production reader must reject the source *before* candidate selection.
    assert.ok(decoded && typeof decoded === 'object')
    assert.equal(read(source).invalid, true)
    assert.deepEqual(read(source).jsonLdBlocks, [])
  })
}

test('preserve distinct backslash-u literal key and ordinary url key', () => {
  // TWO JSON backslashes mean the key actually contains a literal \\u0075,
  // NOT a Unicode escape. This is not the same JSON property name as url.
  const raw = String.raw`{"url":"https://approved.example.test/a","\\u0075rl":"literal-key"}`
  const decoded = JSON.parse(raw)
  assert.deepEqual(Object.keys(decoded), ['url', '\\u0075rl'])
  const evidence = read(raw)
  assert.equal(evidence.invalid, false)
  assert.equal(evidence.jsonLdBlocks[0].url, 'https://approved.example.test/a')
  assert.equal(evidence.jsonLdBlocks[0]['\\u0075rl'], 'literal-key')
})

test('reject escaped-key collisions in nested Nuxt structures', () => {
  const raw = String.raw`[{"price":249,"\u0070rice":1}]`
  const evidence = readAuthorizedHtmlScriptEvidence(nuxt(raw))
  assert.equal(evidence.invalid, true)
  assert.equal(evidence.nuxtPayload, null)
})

test('allow same decoded Unicode key in separate Nuxt array objects', () => {
  const raw = String.raw`[{"\u0070rice":249},{"price":199}]`
  const evidence = readAuthorizedHtmlScriptEvidence(nuxt(raw))
  assert.equal(evidence.invalid, false)
  assert.deepEqual(evidence.nuxtPayload, [{ price: 249 }, { price: 199 }])
})

test('malformed JSON escape remains invalid evidence', () => {
  const raw = String.raw`{"url":"x","\uZZZZ":"y"}`
  const evidence = read(raw)
  assert.equal(evidence.invalid, true)
  assert.deepEqual(evidence.jsonLdBlocks, [])
})
