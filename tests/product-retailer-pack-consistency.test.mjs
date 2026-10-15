import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Fictional product pages only.
const item = (store, pack, price=129) => ({
  supermarket:store,sourceProductId:'fake-milk-1',name:'Halfvolle melk',
  currentPriceCents:price,currency:'EUR',pack,availability:'available',offer:null,
  provenance:{supermarket:store,kind:'product',
    url:store==='plus'?'https://www.plus.nl/product/fake-milk-1':
      'https://www.dekamarkt.nl/producten/fake-milk-1',
    capturedAt:'2026-10-15T09:00:00Z',sha256:'1'.repeat(64)},
})
const compare = (pack) => compareReviewedCatalogs({
  requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
  observations:[
    item('plus',{amount:1000,unit:'ml',rawText:'1 l'}),
    item('dekamarkt',pack,119),
  ],
  nowMs:Date.parse('2026-10-15T10:00:00Z'),
})
test('pack label and numeric amount mismatch withholds entire basket decision',()=>{
  for(const pack of [
    {amount:1000,unit:'ml',rawText:'500 ml'},
    {amount:500,unit:'ml',rawText:'1 l'},
    {amount:500,unit:'g',rawText:'500 ml'},
  ]) {
    const r=compare(pack)
    assert.equal(r.comparable,false)
    assert.equal(r.cheaperStore,null)
    assert.equal(r.savingsCents,null)
    assert.equal(r.claimable,false)
  }
})
test('physically equivalent ml/l and true multipack remain comparable',()=>{
  for(const pack of [
    {amount:1000,unit:'ml',rawText:'1 l'},
    {amount:1,unit:'l',rawText:'1000 ml'},
    {amount:500,unit:'ml',rawText:'2 x 500 ml'},
  ]) {
    const r=compare(pack)
    assert.equal(r.comparable,true)
    assert.equal(r.claimable,false)
    assert.equal(r.cheaperStore,'dekamarkt')
  }
})
test('price and original evidence objects remain immutable after comparison',()=>{
  const pack={amount:1000,unit:'ml',rawText:'500 ml'}
  const before=JSON.stringify(pack)
  compare(pack)
  assert.equal(JSON.stringify(pack),before)
})
