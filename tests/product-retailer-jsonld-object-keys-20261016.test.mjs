import test from 'node:test'
import assert from 'node:assert/strict'
import { readAuthorizedHtmlScriptEvidence } from '../scripts/retailer-approved-html-script-evidence.mjs'

// In-memory fake HTML. No source permission, retailer HTTP, saved prices or
// public results. These exercise the actual bounded JSON-LD/NUXT reader.
const jsonld = (text) => '<script type="application/ld+json">' + text + '</script>'
const nuxt = (text) => '<script id="__NUXT_DATA__" type="application/json">' + text + '</script>'

test('nested conflicting offer object keys are refused at any depth', () => {
  const source = '{"@type":"Product","offers":[{"price":"2.49","price":"999.99"}]}'
  const evidence = readAuthorizedHtmlScriptEvidence(jsonld(source))
  assert.equal(evidence.invalid, true)
  assert.deepEqual(evidence.jsonLdBlocks, [])
})

test('duplicate keys with equivalent decoded Unicode escapes are ambiguous', () => {
  const source = String.raw`{"url":"https://source.example.test/a","\\u0075rl":"https://else.invalid/a"}`
  const evidence = readAuthorizedHtmlScriptEvidence(jsonld(source))
  assert.equal(evidence.invalid, true)
})

test('independent nested objects may each legitimately use the same name key', () => {
  const source = '{"name":"fictional","offers":[{"name":"offer one"},{"name":"offer two"}]}'
  const evidence = readAuthorizedHtmlScriptEvidence(jsonld(source))
  assert.equal(evidence.invalid, false)
  assert.equal(evidence.jsonLdBlocks[0].offers[1].name, 'offer two')
})

test('quoted JSON string content containing braces and colons is not treated as a key', () => {
  const source = JSON.stringify({
    name: 'A quoted fake key: "price":"0.01" with {"url":"fictional"}',
    offers: { price: '2.49' },
  })
  const evidence = readAuthorizedHtmlScriptEvidence(jsonld(source))
  assert.equal(evidence.invalid, false)
  assert.equal(evidence.jsonLdBlocks[0].offers.price, '2.49')
})

test('Nuxt nested object conflicting keys are refused rather than overwritten', () => {
  const evidence = readAuthorizedHtmlScriptEvidence(nuxt('[{"price":299,"price":100}]'))
  assert.equal(evidence.invalid, true)
  assert.equal(evidence.nuxtPayload, null)
})

test('well formed Nuxt array without duplicate object keys retains private parsed structure', () => {
  const evidence = readAuthorizedHtmlScriptEvidence(nuxt('[{"price":299},{"price":100}]'))
  assert.equal(evidence.invalid, false)
  assert.equal(evidence.nuxtPayload.length, 2)
})
