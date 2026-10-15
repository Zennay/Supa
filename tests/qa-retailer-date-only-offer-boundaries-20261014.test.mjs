import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

/** All products/prices are fictional. Inspect strict UTC date-only Offer window.
 * A YYYY-MM-DD priceValidUntil is inclusive through that complete UTC day.
 */
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const requirement={id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}
function row(shop,price,from=null,to=null){
  return {
    supermarket:shop,sourceProductId:'milk-fixture',name:'Halfvolle melk',
    currentPriceCents:price,currency:'EUR',
    availability:'available',pack:{rawText:'1 l',amount:1000,unit:'ml'},
    offer:{label:'fictional unconditional offer',mechanics:null,
      offerPriceCents:price,originalPriceCents:null,
      validFrom:from,validTo:to},
    provenance:{
      supermarket:shop,kind:'product',
      url:shop==='plus'?'https://www.plus.nl/product/fictional-milk'
        :'https://www.dekamarkt.nl/producten/fictional-milk',
      capturedAt:'2026-10-15T09:00:00.000Z',sha256:'a'.repeat(64),
    },
  }
}
const compare=(from,to)=>compareReviewedCatalogs({
  requirements:[requirement],
  observations:[row('plus',129),row('dekamarkt',119,from,to)],
  nowMs:NOW,
})
function assertWinner(r){
  assert.equal(r.comparable,true,'Offer is valid throughout its declared final UTC date')
  assert.equal(r.stores.plus.subtotalCents,258)
  assert.equal(r.stores.dekamarkt.subtotalCents,238)
  assert.equal(r.cheaperStore,'dekamarkt')
  assert.equal(r.savingsCents,20)
  assert.equal(r.claimable,false)
}
function assertNoWinner(r){
  assert.equal(r.comparable,false)
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
  assert.equal(r.claimable,false)
}
test('date-only priceValidUntil equal to capture day must stay valid until UTC end-of-day',()=>{
  assertWinner(compare('2026-10-15','2026-10-15'))
})
test('equivalent explicit UTC end-of-day timestamp is still valid today',()=>{
  assertWinner(compare('2026-10-15','2026-10-15T23:59:59.999Z'))
})
test('tomorrow date-only expiry keeps today valid too',()=>{
  assertWinner(compare('2026-10-15','2026-10-16'))
})
test('EXPECTED RED before validity fix: yesterday date-only priceValidUntil must be expired',()=>{
  assertNoWinner(compare('2026-10-14','2026-10-14'))
})
test('EXPECTED RED before validity fix: tomorrow date-only validFrom must not support current price',()=>{
  assertNoWinner(compare('2026-10-16','2026-10-20'))
})
