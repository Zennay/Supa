import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
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
