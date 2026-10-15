import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPrintablePrivateShoppingChecklist } from '../scripts/retailer-private-shopping-checklist-html.mjs'

// Independent QA assertions: inspect the actual generated page without
// assuming CSS declaration blocks cannot contain nested braces.
function fixture() {
  const row = (price, shop) => ({
    status:'matched', packs:1, packPriceCents:price, totalCents:price,
    productId:'fictional-' + shop, productName:'Fictief pak melk',
  })
  return {format:'supa-local-snapshot-comparison-v1',
    comparison:{provenance:'offline-snapshot-preview',claimable:false,
      stores:{plus:{complete:true,subtotalCents:129},
        dekamarkt:{complete:true,subtotalCents:119}},
      lines:[{ingredientId:'fictional-milk',ingredient:'melk',
        plus:row(129,'plus'),dekamarkt:row(119,'deka')}]}}
}

test('no-script store selector binds PLUS and Deka radio controls to opposite card hiding', () => {
  const html=renderPrintablePrivateShoppingChecklist(fixture())
  const css=/<style>([\s\S]*?)<\/style>/.exec(html)?.[1]
  assert.ok(css,'Inline, offline CSS required')
  assert.match(html, /id="view-both" checked/)
  assert.match(html, /id="view-plus"/)
  assert.match(html, /id="view-deka"/)
  assert.equal((html.match(/name="storeView"/g)||[]).length,3)
  assert.match(html, /class="shop shop-plus"/)
  assert.match(html, /class="shop shop-dekamarkt"/)
  assert.ok(css.includes('body:has(#view-plus:checked) .shop-dekamarkt'))
  assert.ok(css.includes('body:has(#view-deka:checked) .shop-plus'))
  assert.match(css,/\.shop-dekamarkt,body:has\(#view-deka:checked\) \.shop-plus\{display:none\}/)
  assert.doesNotMatch(html, /<script\b|https?:\/\/|<form\b/i)
})

test('print-only filter hide is present after @media print even with nested CSS blocks', () => {
  const html=renderPrintablePrivateShoppingChecklist(fixture())
  const css=/<style>([\s\S]*?)<\/style>/.exec(html)?.[1]
  assert.ok(css)
  const start=css.indexOf('@media print{')
  assert.ok(start>=0,'Print layout must exist')
  const filter=css.indexOf('.store-filter{display:none}',start)
  assert.ok(filter>start,'Store radio controls must not be printed')
  assert.match(css.slice(start),/\.shop\{break-inside:avoid/)
  assert.match(html,/type="checkbox"/)
  assert.match(html,/Geen live prijzen|GEEN LIVE PRIJS/i)
})
