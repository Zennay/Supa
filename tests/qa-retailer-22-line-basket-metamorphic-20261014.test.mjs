import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

/** Synthetic 11+11 invariant tests for the real basket comparator.
 * The prices, sources and shopping demands are fictional and never claimable. */
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const names=[
  'avocado','amandelmelk','bloemkool','champignon','edamame','fusilli',
  'havermout','kikkererwten','linzen','olijfolie','pindakaas',
]
const requirements=names.map((query,i)=>({
  id:'req-'+i,query,amount:1000,unit:'g',
}))
const item=(shop,i,price)=>({
  supermarket:shop,sourceProductId:'fictional-'+i,name:names[i],
  currentPriceCents:price,currency:'EUR',
  pack:{amount:500,unit:'g',rawText:'500 g'},
  availability:'available',offer:null,
  provenance:{
    supermarket:shop,kind:'product',
    url:shop==='plus'
      ? 'https://www.plus.nl/product/fictional-'+i
      : 'https://www.dekamarkt.nl/producten/fictional-'+i,
    capturedAt:'2026-10-15T09:00:00.000Z',
    sha256:(i+1).toString(16).padStart(64,'0'),
  },
})
const observations=()=>names.flatMap((_,i)=>[
  item('plus',i,125+i),item('dekamarkt',i,115+i),
])
const compare=(o,reqs=requirements)=>compareReviewedCatalogs({
  observations:o,requirements:reqs,nowMs:NOW,
})
const total=(shop,items)=>items.filter(x=>x.supermarket===shop)
  .reduce((sum,x)=>sum+2*x.currentPriceCents,0)
test('22 independent source lines are exactly invariant to five deterministic reorderings',()=>{
  const baseline=observations()
  const original=JSON.stringify(baseline)
  const expected=compare(baseline)
  assert.equal(expected.comparable,true)
  assert.equal(expected.cheaperStore,'dekamarkt')
  assert.equal(expected.savingsCents,220)
  for(const reordered of [
    [...baseline].reverse(),
    [...baseline].sort((a,b)=>a.supermarket.localeCompare(b.supermarket)),
    [...baseline].sort((a,b)=>b.sourceProductId.localeCompare(a.sourceProductId)),
    [...baseline.slice(6),...baseline.slice(0,6)],
    [...baseline.filter((_,i)=>i%2),...baseline.filter((_,i)=>i%2===0)],
  ]) assert.deepEqual(compare(reordered),expected)
  assert.equal(JSON.stringify(baseline),original)
  assert.equal(expected.claimable,false)
})
test('independent 22-price cent arithmetic remains exact as one store monotonically grows more expensive',()=>{
  const baseline=observations()
  const increased=baseline.map(x=>x.supermarket==='dekamarkt'
    ? {...x,currentPriceCents:x.currentPriceCents+25} : x)
  const initial=compare(baseline),changed=compare(increased)
  assert.equal(initial.stores.plus.subtotalCents,total('plus',baseline))
  assert.equal(initial.stores.dekamarkt.subtotalCents,total('dekamarkt',baseline))
  assert.equal(initial.savingsCents,220)
  assert.equal(changed.stores.plus.subtotalCents,total('plus',increased))
  assert.equal(changed.stores.dekamarkt.subtotalCents,total('dekamarkt',increased))
  assert.equal(changed.stores.dekamarkt.subtotalCents,
    initial.stores.dekamarkt.subtotalCents+11*2*25)
  assert.equal(changed.cheaperStore,'plus')
  assert.equal(changed.savingsCents,330)
  assert.equal(changed.claimable,false)
})
test('whole-pack discontinuity above exact 1kg boundary applies to every synthetic store line',()=>{
  const base=compare(observations())
  const higher=compare(observations(),requirements.map(r=>({
    ...r,amount:1001,
  })))
  assert.equal(base.comparable,true)
  assert.equal(higher.comparable,true)
  for(let i=0;i<11;i++){
    assert.equal(base.lines[i].plus.packs,2)
    assert.equal(base.lines[i].dekamarkt.packs,2)
    assert.equal(higher.lines[i].plus.packs,3)
    assert.equal(higher.lines[i].dekamarkt.packs,3)
  }
  assert.equal(higher.stores.plus.subtotalCents,observations()
    .filter(x=>x.supermarket==='plus').reduce((sum,x)=>sum+3*x.currentPriceCents,0))
  assert.equal(higher.stores.dekamarkt.subtotalCents,observations()
    .filter(x=>x.supermarket==='dekamarkt').reduce((sum,x)=>sum+3*x.currentPriceCents,0))
  assert.equal(higher.savingsCents,330)
  assert.equal(higher.claimable,false)
})
