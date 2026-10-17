import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { validateRawProductObservation } from '../src/data/ingestion.ts'

/** Entirely fictional, offline source observations. 
 * Different retailer price fields must not quietly contradict each other.
 */
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const at='2026-10-15T09:00:00.000Z'
const required=[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}]
function observation(shop,price,offerPrice=price,original=price+30,id='sku-milk',name='Halfvolle melk') {
  return {
    supermarket:shop,sourceProductId:id,name,currentPriceCents:price,
    currency:'EUR',
    pack:{rawText:'1 l',amount:1000,unit:'ml'},
    offer:{label:'fictional unconditional Offer',mechanics:null,
      offerPriceCents:offerPrice,originalPriceCents:original,
      validFrom:null,validTo:null},
    availability:'available',
    provenance:{supermarket:shop,kind:'product',capturedAt:at,
      url:shop==='plus'?'https://www.plus.nl/product/fictional-milk'
        :'https://www.dekamarkt.nl/producten/fictional-milk',
      sha256:'a'.repeat(64)},
  }
}
const compare=(observations,requirements=required)=>compareReviewedCatalogs({
  requirements,observations,nowMs:NOW,
})
function assertWithhold(r){
  assert.equal(r.claimable,false)
  assert.equal(r.comparable,false,'conflicting exact checkout prices cannot establish a basket winner')
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
}

test('consistent unconditional Offer/current checkout cents and larger original cents still compute 2-pack difference',()=>{
  const plus=observation('plus',129,129,159)
  const deka=observation('dekamarkt',119,119,149)
  assert.doesNotThrow(()=>validateRawProductObservation(plus))
  assert.doesNotThrow(()=>validateRawProductObservation(deka))
  const r=compare([plus,deka])
  assert.equal(r.comparable,true)
  assert.equal(r.stores.plus.subtotalCents,258)
  assert.equal(r.stores.dekamarkt.subtotalCents,238)
  assert.equal(r.cheaperStore,'dekamarkt')
  assert.equal(r.savingsCents,20)
  assert.equal(r.claimable,false)
})

test('known normal checkout price plus explicitly unknown promotional cents is not falsely rejected',()=>{
  const plus=observation('plus',129,null,159)
  const deka=observation('dekamarkt',119,null,149)
  const r=compare([plus,deka])
  assert.equal(r.comparable,true)
  assert.equal(r.stores.plus.subtotalCents,258)
  assert.equal(r.stores.dekamarkt.subtotalCents,238)
  assert.equal(r.savingsCents,20)
  assert.equal(r.claimable,false)
})

test('EXPECTED RED: raw product validation rejects inconsistent unconditional Offer and checkout cents',()=>{
  const contradictory=observation('dekamarkt',20,119,159)
  assert.throws(()=>validateRawProductObservation(contradictory),
    /offer|price|cent|contradict|mismatch|inconsisten/i)
})

test('EXPECTED RED: artificially cheap currentPrice cannot beat a contradictory known higher Offer.price',()=>{
  const r=compare([observation('plus',129),observation('dekamarkt',20,119,159)])
  assertWithhold(r)
})

test('EXPECTED RED: known cheap Offer.price cannot be silently ignored in favor of contradictory currentPrice',()=>{
  const r=compare([observation('plus',129),observation('dekamarkt',119,20,159)])
  assertWithhold(r)
})

test('EXPECTED RED: one inconsistent Offer/current price in a full 11+11 fictional basket withdraws whole winner',()=>{
  const terms=['halfvolle melk','amandelmelk','havermout','olijfolie','linzen',
    'edamame','basilicum','tahin','courgette','kikkererwten','tomatenpuree']
  const requirements=terms.map((query,i)=>({id:'item-'+i,query,amount:1500,unit:'ml'}))
  const items=terms.flatMap((query,i)=>{
    const plus=observation('plus',129+i,129+i,159+i,'plus-'+i,query)
    const deka=observation('dekamarkt',119+i,119+i,149+i,'deka-'+i,query)
    return [plus,i===8?{
      ...deka,currentPriceCents:20,
      offer:{...deka.offer,offerPriceCents:119+i},
    }:deka]
  })
  assertWithhold(compare(items,requirements))
})
