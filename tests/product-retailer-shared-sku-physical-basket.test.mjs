import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// All amounts and prices fictional; comparison cannot be used to claim savings.
const NOW=Date.parse('2026-10-15T10:00:00Z')
const obs=(shop,price)=>({
  supermarket:shop,sourceProductId:'fictional-milk',name:'Halfvolle melk',
  currentPriceCents:price,currency:'EUR',
  pack:{amount:1000,unit:'ml',rawText:'1 l'},availability:'available',offer:null,
  provenance:{supermarket:shop,kind:'product',capturedAt:'2026-10-15T09:00:00Z',
    url:shop==='plus'?'https://www.plus.nl/product/fictional-milk':
      'https://www.dekamarkt.nl/producten/fictional-milk',
    sha256:'b'.repeat(64)},
})
const compare=(requirements)=>compareReviewedCatalogs({
  requirements,observations:[obs('plus',129),obs('dekamarkt',119)],nowMs:NOW,
})
test('aggregated 800ml requirement still costs exactly one liter package',()=>{
  const result=compare([{id:'milk',query:'halfvolle melk',amount:800,unit:'ml'}])
  assert.equal(result.comparable,true)
  assert.equal(result.stores.plus.subtotalCents,129)
  assert.equal(result.stores.dekamarkt.subtotalCents,119)
  assert.equal(result.savingsCents,10)
  assert.equal(result.claimable,false)
})
test('split 400ml and 0.4l of same physical SKU cannot charge twice',()=>{
  const result=compare([
    {id:'first',query:'halfvolle melk',amount:400,unit:'ml'},
    {id:'second',query:'halfvolle melk',amount:0.4,unit:'l'},
  ])
  assert.equal(result.comparable,false)
  assert.equal(result.cheaperStore,null)
  assert.equal(result.savingsCents,null)
  assert.equal(result.claimable,false)
  for(const line of result.lines) {
    assert.equal(line.plus.totalCents,null)
    assert.equal(line.dekamarkt.totalCents,null)
    assert.equal(line.differenceCents,null)
  }
})
