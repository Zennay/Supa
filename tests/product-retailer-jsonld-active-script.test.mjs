import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

const src=SOURCES.find(x=>x.id==='plus-product-halfvolle-melk')
const product=JSON.stringify({
  '@context':'https://schema.org', '@type':'Product', name:'Halfvolle melk',
  sku:'fictional',weight:{value:'1000 ml'},
  offers:{'@type':'Offer',price:'1.29',priceCurrency:'EUR',
    availability:'https://schema.org/InStock'},
})
const parse=(html)=>parseOfflineRetailerSnapshot({
  source:src, html, capturedAt:'2026-10-15T09:00:00Z',
})
test('genuine script type and case-insensitive HTML metadata remain accepted',()=>{
  for(const attrs of [
    'type="application/ld+json"',
    "TYPE='application/ld+json'",
    'data-key="other" type="application/ld+json"',
  ]) {
    const r=parse('<script '+attrs+'>'+product+'</script>')
    assert.equal(r.scriptsInspected,1)
    assert.equal(r.observations.length,1)
    assert.equal(r.observations[0].currentPriceCents,129)
  }
})
test('lookalike script attributes or values are never accepted as Product evidence',()=>{
  for(const attrs of [
    'data-type="application/ld+json"',
    'x-type="application/ld+json"',
    'not-type="application/ld+json"',
    'data-x=" type=\\\'application/ld+json\\\'"',
    'type="text/javascript"',
  ]) {
    const r=parse('<script '+attrs+'>'+product+'</script>')
    assert.equal(r.scriptsInspected,0,attrs)
    assert.equal(r.observations.length,0,attrs)
  }
})
test('HTML-commented JSON-LD cannot mint a purchasable product observation',()=>{
  for(const html of [
    '<!-- <script type="application/ld+json">'+product+'</script> -->',
    '<html><body><!-- hidden <script type="application/ld+json">'+product+'</script> --></body></html>',
  ]) {
    const r=parse(html)
    assert.equal(r.scriptsInspected,0)
    assert.equal(r.observations.length,0)
  }
})
