import assert from 'node:assert/strict'
import test from 'node:test'
import { renderRetailerSearchHtml } from '../scraper/retailer-search-html.mjs'

test('same-origin no-JS search page has accessible GET form and no direct script/fetch',()=>{
  const html=renderRetailerSearchHtml('melk',{results:[]})
  assert.match(html,/<form action="\/retailer-zoeken" method="get">/)
  assert.match(html,/type="search"/)
  assert.match(html,/name="q"/)
  assert.doesNotMatch(html,/<script|fetch\(|XMLHttpRequest/i)
})

test('server-side output escapes malicious product/query fields and preserves cent values',()=>{
  const html=renderRetailerSearchHtml('<img src=x onerror=alert(1)>',{
    results:[{
      supermarket:'dirk',
      supermarketName:'Dirk <script>evil</script>',
      name:'Test <b>pindakaas</b>',
      pack:'500 g',
      priceCents:199,
      offer:true,
      observedAt:'2026-10-16T11:00:00.000Z',
      sourceUrl:'https://www.dirk.nl/producten/test-123',
    }],
  })
  assert.match(html,/€ 1,99/)
  assert.match(html,/&lt;b&gt;pindakaas&lt;\/b&gt;/)
  assert.match(html,/&lt;script&gt;evil&lt;\/script&gt;/)
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html,/<img src=x|<script>evil/)
})

test('sources not approved renders unmistakable no-current-price message',()=>{
  const html=renderRetailerSearchHtml('melk',{
    availability:'sources-not-approved',results:[],
  })
  assert.match(html,/Nog geen goedgekeurde actuele supermarktprijzen beschikbaar/)
  assert.doesNotMatch(html,/class="price"/)
})
