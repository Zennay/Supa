import assert from 'node:assert/strict'
import test from 'node:test'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// All observations and prices are fictional; no retailer access.
const nowMs=Date.parse('2026-10-15T10:00:00Z')
function item(shop,price,offerPrice,mechanics=null){
  return {
    supermarket:shop,sourceProductId:'fictional-milk',name:'Halfvolle melk',
    currentPriceCents:price,currency:'EUR',
    pack:{rawText:'1 l',amount:1000,unit:'ml'},
    offer:{label:'fictional test offer',mechanics,
      offerPriceCents:offerPrice,originalPriceCents:159,
      validFrom:null,validTo:null},
    availability:'available',provenance:{supermarket:shop,kind:'product',
      capturedAt:'2026-10-15T09:00:00Z',sha256:'a'.repeat(64),
      url:shop==='plus'?'https://www.plus.nl/product/fictional':
        'https://www.dekamarkt.nl/producten/fictional'},
  }
}
function compare(...observations){
  return compareReviewedCatalogs({observations,nowMs,
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}]})
}
test('exact and unknown unconditional offer cents preserve checkout totals',()=>{
  for(const offerPrice of [119,null]){
    const r=compare(item('plus',129,129),item('dekamarkt',119,offerPrice))
    assert.equal(r.comparable,true)
    assert.equal(r.stores.plus.subtotalCents,258)
    assert.equal(r.stores.dekamarkt.subtotalCents,238)
    assert.equal(r.savingsCents,20)
    assert.equal(r.claimable,false)
  }
})
test('contradictory unconditional prices fail raw validation and withhold both directions of savings',()=>{
  for(const [current,offer] of [[20,119],[119,20]]){
    const row=item('dekamarkt',current,offer)
    assert.throws(()=>validateRawProductObservation(row),/Offer price.*checkout cents/)
    const result=compare(item('plus',129,129),row)
    assert.equal(result.comparable,false)
    assert.equal(result.cheaperStore,null)
    assert.equal(result.savingsCents,null)
    assert.equal(result.claimable,false)
  }
})
test('conditional offer mechanics are not naively treated as the per-pack checkout price',()=>{
  const conditional=item('dekamarkt',119,20,'2-for-1')
  assert.doesNotThrow(()=>validateRawProductObservation(conditional))
  const result=compare(item('plus',129,129),conditional)
  assert.equal(result.claimable,false)
})
