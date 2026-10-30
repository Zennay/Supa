import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { isAllowedM1RetailerSourcePath } from '../scripts/retailer-source-route-safety.mjs'
import { proposeRetailerSelectors } from '../scripts/retailer-snapshot-selector-proposals.mjs'

function capture(html, at='2026-10-04T12:00:00Z') {
  return {
    id:'offline-fictional-source',supermarket:'plus',kind:'catalog',
    requestedUrl:'https://www.plus.nl/producten',
    capturedAt:at,sha256:createHash('sha256').update(html).digest('hex'),
  }
}
test('valid complete script, template, HTML comment and visible product cards stay review-only',()=>{
  const html='<article class="product-card"></article>'+
    '<script type="application/json">{"text":"<span class=\\\"price-card\\\"></span>"}</script>'+
    '<template><span class="offer-price"></span></template>'+
    '<!-- <span class="stock-availability"></span> -->'
  const report=proposeRetailerSelectors(capture(html),html)
  assert.ok(report.proposedSelectors.some(x=>x.selector==='article.product-card'))
  assert.ok(report.proposedSelectors.every(x=>x.status==='UNVERIFIED_PROPOSAL'))
  assert.ok(!report.proposedSelectors.some(x=>/price-card|offer-price|stock-availability/.test(x.selector)))
  assert.equal(report.publicationAllowed,false)
  assert.equal(report.readyForScraping,false)
})
test('truncated inert markup never promotes hidden price or stock CSS hints',()=>{
  const bad=[
    '<article class="product-card"></article><script type="application/json">{"x":"<div class=\\"offer-price\\">"',
    '<template><div class="product-price"></div>',
    '<!-- <span class="stock-availability"></span>',
    '<head><meta class="price-value">',
    '<svg><span class="product-price"></span>',
    '<script>let fake="<div class=\\"product-price\\">";</script><template><div class="offer-deal">',
  ]
  for (const html of bad) {
    assert.throws(()=>proposeRetailerSelectors(capture(html),html),/Offline selector review refused/)
  }
})
test('correct SHA does not authorize observation timestamps from the future',()=>{
  const html='<span class="product-title">Test-only</span>'
  assert.throws(()=>proposeRetailerSelectors(capture(html,'2035-01-01T00:00:00Z'),html),
    /Offline selector review refused/)
})
test('historic archived selector source rejects impossible UTC civil dates, retaining genuine leap days',()=>{
  const html='<article class="product-card"></article>'
  for(const at of [
    '2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z',
    '1900-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
  ]) assert.throws(()=>proposeRetailerSelectors(capture(html,at),html),
    /Offline selector review refused/,at)
  const leap=proposeRetailerSelectors(capture(html,'2024-02-29T12:00:00Z'),html)
  assert.equal(leap.readyForScraping,false)
  assert.equal(leap.publicationAllowed,false)
})

test('historic archiver cannot label checkout/admin/foreign retailer routes as reviewed M1 source',()=>{
  const html='<article class="product-card"></article>'
  for(const [supermarket,kind,requestedUrl] of [
    ['plus','catalog','https://www.plus.nl/checkout'],
    ['plus','product','https://www.plus.nl/admin'],
    ['plus','product','https://www.plus.nl/product/'],
    ['plus','product','https://www.plus.nl/product/%2fadmin'],
    ['plus','catalog','https://www.plus.nl/producten/%2e%2e/checkout'],
    ['dekamarkt','offers','https://www.dekamarkt.nl/mijn-account'],
    ['dekamarkt','product','https://www.dekamarkt.nl/producten/'],
  ]) {
    const candidate={...capture(html),supermarket,kind,requestedUrl}
    assert.throws(()=>proposeRetailerSelectors(candidate,html),
      /Offline selector review refused/,requestedUrl)
  }
  const allowed={...capture(html),kind:'product',
    requestedUrl:'https://www.plus.nl/product/synthetic-abc'}
  assert.equal(proposeRetailerSelectors(allowed,html).readyForScraping,false)
})

test('tampering HTML after SHA validation still refuses selector review',()=>{
  const html='<div class="product-card"></div>'
  const source=capture(html)
  assert.throws(()=>proposeRetailerSelectors(source,html+'<span class="product-name"></span>'),
    /Offline selector review refused/)
})
test('unmatched closing inert element is not considered ordinary product DOM',()=>{
  const html='<div class="product-name"></div></script>'
  assert.throws(()=>proposeRetailerSelectors(capture(html),html),/Offline selector review refused/)
})
test('source URLs with credentials remain forbidden with no secret echo',()=>{
  const html='<article class="product-card"></article>'
  const s=capture(html)
  s.requestedUrl='https://fake:FAKE_SECRET@www.plus.nl/producten'
  assert.throws(()=>proposeRetailerSelectors(s,html),/Offline selector review refused/)
})

test('M1 shared storefront source route gate matches both retailer capture families',()=>{
  for(const [store,kind,path] of [
    ['plus','product','/product/synthetic-42'],
    ['plus','catalog','/producten'],['plus','catalog','/producten/'],
    ['plus','offers','/aanbiedingen'],
    ['dekamarkt','product','/producten/synthetic-42'],
    ['dekamarkt','catalog','/producten/synthetic-catalog'],
    ['dekamarkt','offers','/aanbiedingen'],
  ]) assert.equal(isAllowedM1RetailerSourcePath(store,kind,path),true,path)
  for(const [store,kind,path] of [
    ['plus','product','/product/'],['plus','catalog','/checkout'],
    ['plus','product','/product/%2fcheckout'],
    ['dekamarkt','product','/producten/'],
    ['dekamarkt','offers','/mijn-account'],
    ['dekamarkt','product','/producten/%252fadmin'],
  ]) assert.equal(isAllowedM1RetailerSourcePath(store,kind,path),false,path)
})
