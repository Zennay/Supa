import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'

// Direct JS string interface has no raw source Buffer to verify against.
// Never silently fingerprint U+FFFD when the supplied text had lone UTF-16.
const source = SOURCES.find(s => s.id === 'plus-product-halfvolle-melk')
const capturedAt = '2026-10-15T10:00:00Z'
const product = '<script type="application/ld+json">' + JSON.stringify({
  '@type': 'Product', sku: 'fictional-milk', name: 'Halfvolle melk',
  weight: { value: '1000 ml' }, offers: { '@type': 'Offer', price: '1.29',
    priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
}) + '</script>'

for(const [name,bad] of [
  ['lone high surrogate',String.fromCharCode(0xd800)],
  ['lone low surrogate',String.fromCharCode(0xdc00)],
  ['high surrogate after ordinary text','Milk'+String.fromCharCode(0xd83e)],
  ['two unmatched high surrogates',String.fromCharCode(0xd800,0xd800)],
  ['backwards low-high',String.fromCharCode(0xdc00,0xd800)],
]) {
  test('direct M3 parser rejects lossy string '+name,()=>{
    assert.throws(()=>parseOfflineRetailerSnapshot({source,html:product+bad,capturedAt}),
      /Invalid UTF-8 source text/)
  })
}
for(const [name,html] of [
  ['plain ASCII',product],
  ['valid emoji',product+'🥛'],
  ['UTF-8 BOM with emoji','\\uFEFF'+product+'🥛'],
]) {
  test('direct M3 parser preserves valid bytes and digest '+name,()=>{
    const result=parseOfflineRetailerSnapshot({source,html,capturedAt})
    assert.equal(result.observations.length,1)
    assert.equal(result.provenance.sha256,
      createHash('sha256').update(Buffer.from(html,'utf8')).digest('hex'))
  })
}
