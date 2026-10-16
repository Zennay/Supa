import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUniqueKeyRetailerJson } from '../scripts/retailer-private-unique-key-json.mjs'
import { parseM3OfflineProductHtml } from '../scripts/m3-offline-html-product.mjs'

const url = 'https://www.plus.nl/product/fictional-offline-123'
const time = '2026-10-14T12:00:00Z'
const source = { supermarket: 'plus', kind: 'product', url }
const good = {
  '@context': 'https://schema.org', '@type': 'Product',
  url, sku: 'FICTION-123', name: 'Fictional shelf item',
  weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
  offers: { '@type': 'Offer', price: '2.45', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
}
const page = json => '<script type="application/ld+json">' + json + '</script>'
const parse = json => parseM3OfflineProductHtml({
  source, capturedAt: time, html: page(json),
})

test('genuine unique nested JSON-LD names and escaped strings remain valid', () => {
  const sample = JSON.stringify(good)
  assert.deepEqual(parseUniqueKeyRetailerJson(sample), good)
  assert.equal(parse(sample).type, 'observation')
  assert.equal(parse(sample).observation.currentPriceCents, 245)
  assert.deepEqual(parseUniqueKeyRetailerJson(
    String.raw`{"name":"A","n\u0061me2":"B","offers":[{"price":1},{"price":2}]}`),
    { name: 'A', name2: 'B', offers: [{ price: 1 }, { price: 2 }] },
  )
})

test('duplicate price / URL in a real synthetic PLUS product script cannot return private observation', () => {
  const valid = JSON.stringify(good)
  const variants = [
    valid.replace('"price":"2.45"', '"price":"999.99","price":"2.45"'),
    valid.replace('"url":"' + url + '"', '"url":"https://other.invalid/product/foreign","url":"' + url + '"'),
    valid.replace('"price":"2.45"', String.raw`"pr\u0069ce":"999.99","price":"2.45"`),
    valid.replace('"priceCurrency":"EUR"', '"priceCurrency":"USD","priceCurrency":"EUR"'),
    valid.replace('"value":500', '"value":3,"value":500'),
  ]
  for (const json of variants) {
    assert.doesNotThrow(() => JSON.parse(json), 'native parser accepts duplicate keys')
    assert.throws(() => parseUniqueKeyRetailerJson(json), /Unsafe or ambiguous/)
    const result = parse(json)
    assert.equal(result.type, 'abstain')
    assert.match(result.reason, /malformed or unsafe/)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(result, 'observation'), false)
  }
})

test('duplicate decoded object keys at ANY nesting level fail closed, even if located in an unrelated graph entry', () => {
  for (const json of [
    String.raw`{"url":"a","\u0075rl":"b"}`,
    '{"a":{"b":{"c":1,"c":2}}}',
    '{"items":[{"a":1},{"b":2,"b":3}]}',
    '{"@graph":[{"@type":"WebPage","name":"A","name":"B"}, {"@type":"Product"}]}',
    '{"__proto__":1,"__proto__":2}',
  ]) {
    assert.throws(() => parseUniqueKeyRetailerJson(json), /Unsafe or ambiguous/)
  }
  assert.deepEqual(parseUniqueKeyRetailerJson('{"a":1,"b":{"a":2}}'), { a: 1, b: { a: 2 } })
})

test('bounded strict decoder refuses malformed syntax, invalid UTF-8 strings, excessive depth and oversized JSON', () => {
  for (const text of [
    '{"a":}', '{"a":1,}', 'true false', '\uD800',
    '['.repeat(65) + '0' + ']'.repeat(65),
    '{"a":"' + 'x'.repeat(256 * 1024) + '"}',
  ]) {
    assert.throws(() => parseUniqueKeyRetailerJson(text), /Unsafe or ambiguous/)
  }
  for (const wrong of [null, {}, [], Buffer.from('{}')]) {
    assert.throws(() => parseUniqueKeyRetailerJson(wrong), /Unsafe or ambiguous/)
  }
})

test('bad first script prevents later legitimate script from becoming cheaper product evidence', () => {
  const clean = JSON.stringify(good)
  const poisoned = clean.replace('"price":"2.45"', '"price":"0.01","price":"2.45"')
  const result = parseM3OfflineProductHtml({
    source, capturedAt: time, html: page(poisoned) + page(clean),
  })
  assert.equal(result.type, 'abstain')
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(result, 'observation'), false)
})

test('an ambiguous non-Product script invalidates later legitimate Product on same physical page', () => {
  const browserPage = '<script type="application/ld+json">' +
    '{"@type":"WebPage","name":"fixture-one","name":"fixture-two"}' +
    '</script>' + page(JSON.stringify(good))
  const result = parseM3OfflineProductHtml({
    source, capturedAt: time, html: browserPage,
  })
  assert.equal(result.type, 'abstain')
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(result, 'observation'), false)
})

test('identical member names in distinct array objects do not cause false duplicate rejection', () => {
  const original = JSON.stringify({
    '@graph': [
      { '@type': 'WebPage', name: 'Independent contextual page' },
      good,
      { '@type': 'Offer', price: '9.99', priceCurrency: 'EUR' },
    ],
  })
  assert.deepEqual(parseUniqueKeyRetailerJson(original), JSON.parse(original))
  const selected = parse(original)
  assert.equal(selected.type, 'observation')
  assert.equal(selected.observation.currentPriceCents, 245)
  assert.equal(selected.publicSavingsClaimEligible, false)
})

test('external src on a declared JSON-LD data block refuses private product price', () => {
  const json = JSON.stringify(good)
  for (const attrs of [
    'type="application/ld+json" src="https://untrusted.invalid/page.js"',
    'TYPE="application/ld+json" SRC="/fake.js"',
    'type="application/ld+json" src',
    'src=\'/test.js\' type="application/ld+json"',
  ]) {
    const result = parseM3OfflineProductHtml({
      source, capturedAt: time, html: '<script ' + attrs + '>' + json + '</script>',
    })
    assert.equal(result.type, 'abstain', attrs)
    assert.equal(Object.hasOwn(result, 'observation'), false)
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})

test('data-src metadata never disables truly inline JSON-LD and src in unrelated non-JSON-LD is not product evidence', () => {
  const valid = JSON.stringify(good)
  for (const attrs of [
    'type="application/ld+json" data-src="ignore"',
    'data-src="src=fake" type="application/ld+json"',
  ]) {
    assert.equal(parseM3OfflineProductHtml({
      source, capturedAt: time, html: '<script ' + attrs + '>' + valid + '</script>',
    }).observation.currentPriceCents, 245)
  }
  const ignored = '<script src="/other.js" type="text/javascript">console.log(1)</script>'
  assert.equal(parseM3OfflineProductHtml({
    source, capturedAt: time, html: ignored + page(valid),
  }).observation.currentPriceCents, 245)
})

test('untrusted external JSON-LD src poisons the entire physical page even if a second valid product follows', () => {
  const valid = JSON.stringify(good)
  for (const combined of [
    '<script src="/untrusted" type="application/ld+json">' + valid + '</script>' + page(valid),
    page(valid) + '<script type="application/ld+json" src>' + valid + '</script>',
  ]) {
    const result = parseM3OfflineProductHtml({ source, capturedAt: time, html: combined })
    assert.equal(result.type, 'abstain')
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})
