import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Entirely synthetic evidence; fixed reference clock for exact timestamp tests.
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const req=[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}]
const source=(shop,at)=>({
  supermarket:shop,kind:'product',
  url:shop==='plus'?'https://www.plus.nl/product/fake-milk':
    'https://www.dekamarkt.nl/producten/fake-milk',
  capturedAt:at,sha256:'a'.repeat(64),
})
const product=(shop,at)=>({
  supermarket:shop,sourceProductId:'fake-milk',name:'Halfvolle melk',
  currentPriceCents:shop==='plus'?129:119,currency:'EUR',
  pack:{amount:1000,unit:'ml',rawText:'1 l'},offer:null,
  availability:'available',provenance:source(shop,at),
})
const compare=(at)=>compareReviewedCatalogs({
  requirements:req,
  observations:[
    product('plus','2026-10-15T09:00:00Z'),
    product('dekamarkt',at),
  ],
  nowMs:NOW,
})
test('one nanosecond after reference clock is rejected rather than millisecond-truncated',()=>{
  for(const at of [
    '2026-10-15T10:00:00.000000001Z',
    '2026-10-15T12:00:00.000000001+02:00',
    '2026-10-15T10:00:00.0001Z',
  ]) {
    const r=compare(at)
    assert.equal(r.comparable,false)
    assert.equal(r.cheaperStore,null)
    assert.equal(r.savingsCents,null)
    assert.equal(r.claimable,false)
  }
})
test('exact boundary and near-past nanosecond remain valid fictional snapshots',()=>{
  for(const at of [
    '2026-10-15T10:00:00.000000000Z',
    '2026-10-15T09:59:59.999999999Z',
    '2026-10-15T09:00:00.000000001Z',
  ]) {
    const r=compare(at)
    assert.equal(r.comparable,true)
    assert.equal(r.savingsCents,20)
    assert.equal(r.claimable,false)
  }
})
