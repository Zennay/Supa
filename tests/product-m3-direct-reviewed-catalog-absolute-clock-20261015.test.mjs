import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

const nowMs=Date.parse('2026-10-15T11:00:00Z')
const demand=[{id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}]
function product(supermarket,capturedAt){
  return {supermarket,sourceProductId:'mock-milk',name:'Halfvolle melk',
    currentPriceCents:supermarket==='plus'?129:119,currency:'EUR',
    pack:{rawText:'1000 ml',amount:1000,unit:'ml'},offer:null,availability:'available',
    provenance:{supermarket,kind:'product',
      url:supermarket==='plus'?'https://www.plus.nl/product/fictional-milk':
      'https://www.dekamarkt.nl/producten/fictional-milk',capturedAt,sha256:'a'.repeat(64)}}
}
function compare(plusClock,dekaClock){return compareReviewedCatalogs({requirements:demand,
  observations:[product('plus',plusClock),product('dekamarkt',dekaClock)],nowMs})}
const good='2026-10-15T10:00:00Z'

for (const clock of [
  '2026-10-15',
  '2026-10-15T00:00:00',
  'Thu, 15 Oct 2026 10:00:00 GMT',
  '2026-02-30T10:00:00Z',
  '2026-10-15T10:00:00+14:01',
  '2026-10-15T10:00:00+23:59',
]){
  for(const shop of ['plus','dekamarkt']){
    test('M3 pure catalog abstains on invalid direct capture '+clock+' for '+shop,()=>{
      const result=compare(shop==='plus'?clock:good,shop==='dekamarkt'?clock:good)
      assert.equal(result.claimable,false)
      assert.equal(result.comparable,false)
      assert.equal(result.cheaperStore,null)
      assert.equal(result.savingsCents,null)
      assert.equal(result.reason,'invalid_or_stale_source')
    })
  }
}

for(const clock of [
  good,'2026-10-15T12:00:00+02:00','2026-10-15T05:00:00-05:00',
  '2026-10-15T10:00:00.123456789Z',
]){
  test('M3 pure catalog compares valid absolute capture '+clock,()=>{
    const result=compare(clock,clock)
    assert.equal(result.claimable,false)
    assert.equal(result.comparable,true)
    assert.equal(result.cheaperStore,'dekamarkt')
    assert.equal(result.savingsCents,10)
  })
}
