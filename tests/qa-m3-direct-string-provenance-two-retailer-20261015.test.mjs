import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'

// Independent QA, wholly synthetic: no HTTP or real shop observations.
// Distinguish actual malformed JS UTF-16 source text from a legitimate
// literal U+FFFD replacement glyph which must remain byte-true.
const capture = '2026-10-15T10:00:00Z'
const product = '<script type="application/ld+json">' + JSON.stringify({
  '@type': 'Product',
  sku: 'fictional-halfvolle-melk',
  name: 'Halfvolle melk',
  weight: { value: '1000 ml' },
  offers: {
    '@type': 'Offer', price: '1.29', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  },
}) + '</script>'
const validHtml = '<!doctype html><body>' + product + '</body>'
const src = ['plus-product-halfvolle-melk', 'dekamarkt-product-halfvolle-melk']
  .map(id => SOURCES.find(item => item.id === id))
assert.ok(src.every(Boolean))

const errors = [
  ['high surrogate before priced HTML', '\ud800' + validHtml],
  ['low surrogate before priced HTML', '\udc00' + validHtml],
  ['high surrogate after fully priced HTML', validHtml + '\udbff'],
  ['low-high reversal after priced HTML', validHtml + '\udc00\ud800'],
  ['lone high surrogate inside otherwise valid HTML attribute',
    validHtml.replace('<body>', '<body data-test="\ud800">')],
  ['lone low surrogate inside text before price script',
    validHtml.replace(product, 'ordinary text \udfff' + product)],
]
for (const source of src) {
  for (const [name, html] of errors) {
    test('QA direct ' + source.supermarket + ' rejects ' + name +
      ' before pricing and source fingerprinting', () => {
      assert.notEqual(Buffer.from(html, 'utf8').toString('utf8'), html,
        'fixture must prove lossy encoding before parser')
      assert.throws(
        () => parseOfflineRetailerSnapshot({ source, html, capturedAt: capture }),
        /Invalid UTF-8 source text/,
      )
    })
  }
  for (const [name, html] of [
    ['original ASCII capture', validHtml],
    ['valid Unicode replacement glyph is NOT an invalid source', validHtml + '\ufffd'],
    ['valid multibyte composed Dutch accents', validHtml + ' Crème fraîche'],
    ['valid emoji / astral UTF-16 pair', validHtml + ' 🥛'],
    ['valid original BOM and emoji bytes', '\ufeff' + validHtml + ' 🥛'],
  ]) {
    test('QA direct ' + source.supermarket + ' retains raw SHA-256 and price for ' +
      name, () => {
      assert.equal(Buffer.from(html, 'utf8').toString('utf8'), html)
      const parsed = parseOfflineRetailerSnapshot({
        source, html, capturedAt: capture,
      })
      assert.equal(parsed.observations.length, 1)
      assert.equal(parsed.observations[0].currentPriceCents, 129)
      assert.equal(parsed.provenance.sha256,
        createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex'))
      assert.equal(parsed.provenance.supermarket, source.supermarket)
      assert.equal(parsed.provenance.capturedAt, capture)
    })
  }
}
