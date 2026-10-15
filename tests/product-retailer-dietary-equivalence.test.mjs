import test from 'node:test'
import assert from 'node:assert/strict'
import { matchIngredient } from '../src/domain/matching.ts'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Fully fictional products, no dietary/health assurance or retailer collection.
const NOW=Date.parse('2026-10-15T10:00:00Z')
const requirement=(query)=>({id:'protein',query,amount:400,unit:'g'})
const candidate=(name)=>({
  id:'mock-1',name,packAmount:400,packUnit:'g',
  packCount:1,available:true,
})
const observation=(shop,name,price)=>({
  supermarket:shop,sourceProductId:'mock-protein',
  name,currentPriceCents:price,currency:'EUR',
  pack:{amount:400,unit:'g',rawText:'400 g'},
  offer:null,availability:'available',provenance:{
    supermarket:shop,kind:'product',sha256:'a'.repeat(64),
    capturedAt:'2026-10-15T09:00:00Z',
    url:shop==='plus'?'https://www.plus.nl/product/fake-protein':
      'https://www.dekamarkt.nl/producten/fake-protein',
  },
})
const compare=(query,dekaName)=>compareReviewedCatalogs({
  requirements:[requirement(query)],nowMs:NOW,
  observations:[
    observation('plus',query,299),
    observation('dekamarkt',dekaName,199),
  ],
})
test('same conventional meat in both shops preserves exact fictional basket arithmetic',()=>{
  const result=compare('rundergehakt','Rundergehakt')
  assert.equal(result.comparable,true)
  assert.equal(result.savingsCents,100)
  assert.equal(result.claimable,false)
})
test('raw matcher refuses misleading animal-meat substitutions',()=>{
  for(const [query,altered] of [
    ['rundergehakt','Vegetarisch rundergehakt'],
    ['rundergehakt','Vegan rundergehakt'],
    ['kipfilet','Plantaardig kipfilet'],
    ['kipfilet','Veganistische kipfilet'],
  ]) {
    const result=matchIngredient(requirement(query),[candidate(altered)])
    assert.equal(result.type,'abstain',query+' / '+altered)
  }
})
test('different dietary variants never determine a cheapest store or savings',()=>{
  for(const [query,other] of [
    ['rundergehakt','Vegetarisch rundergehakt'],
    ['kipfilet','Vegan kipfilet'],
    ['Vegetarisch rundergehakt','Rundergehakt'],
    ['Vegan kipfilet','Kipfilet'],
  ]) {
    const result=compare(query,other)
    assert.equal(result.comparable,false)
    assert.equal(result.cheaperStore,null)
    assert.equal(result.savingsCents,null)
    assert.equal(result.claimable,false)
  }
})
test('consistent dietary descriptors remain eligible for genuine matching',()=>{
  for(const [query,label] of [
    ['vegan kipfilet','Vegan kipfilet'],
    ['vegetarisch rundergehakt','Vegetarisch rundergehakt'],
  ]) {
    const result=matchIngredient(requirement(query),[candidate(label)])
    assert.equal(result.type,'match')
  }
})
