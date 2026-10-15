import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Fictional prices and provenance only. No real retailers or active capture.
const provenance = (shop) => ({
  supermarket:shop, kind:'product',
  url:shop==='plus'?'https://www.plus.nl/product/fictional-milk':
    'https://www.dekamarkt.nl/producten/fictional-milk',
  capturedAt:'2026-10-15T09:00:00Z', sha256:'a'.repeat(64),
})
const item = (shop,price,availability='available') => ({
  supermarket:shop,sourceProductId:'same-physical-sku',
  name:'Halfvolle melk',currentPriceCents:price,currency:'EUR',
  pack:{amount:1000,unit:'ml',rawText:'1 l'},
  offer:null,availability,provenance:provenance(shop),
})
const compare = (rows) => compareReviewedCatalogs({
  requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
  observations:rows,nowMs:Date.parse('2026-10-15T10:00:00Z'),
})
test('independent retailers can report same physical SKU without collision', () => {
  const r=compare([item('plus',129),item('dekamarkt',119)])
  assert.equal(r.comparable,true)
  assert.equal(r.savingsCents,20)
  assert.equal(r.claimable,false)
})
test('available and unavailable copies of one SKU cannot determine any basket winner', () => {
  for (const rows of [
    [item('plus',129),item('plus',null,'unavailable'),item('dekamarkt',119)],
    [item('plus',null,'unavailable'),item('plus',129),item('dekamarkt',119)],
    [item('plus',129),item('dekamarkt',119),item('dekamarkt',null,'unavailable')],
  ]) {
    const before=JSON.stringify(rows)
    const r=compare(rows)
    assert.equal(r.comparable,false)
    assert.equal(r.cheaperStore,null)
    assert.equal(r.savingsCents,null)
    assert.equal(r.claimable,false)
    assert.equal(JSON.stringify(rows),before)
  }
})
test('a unique unavailable SKU is incomplete but not a duplicate-source failure', () => {
  const r=compare([item('plus',129),item('dekamarkt',null,'unavailable')])
  assert.equal(r.comparable,false)
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
})
