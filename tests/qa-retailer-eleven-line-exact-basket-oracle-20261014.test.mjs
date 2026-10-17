import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

/**
 * Independent EXACT 11+11 same-demand oracle for the new *offline catalog*
 * feature (#2622). Not a real PLUS/DekaMarkt field study (#78), and never
 * claimable savings. Arithmetic expectations are derived independently of
 * matchIngredient or catalog financial implementation.
 */
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const NAMES=[
  'amandelmelk', 'tomatenpuree', 'courgette', 'linzen', 'bulgur',
  'pindakaas', 'tahin', 'havermout', 'edamame', 'basilicum', 'bloemkool',
]
const requirements=NAMES.map((query,i)=>({
  id:`ingredient-${i}`,query,amount:1500,unit:'ml',
}))

function product(shop,i,price){
  const isPlus=shop==='plus'
  return {
    supermarket:shop,sourceProductId:`sku-${i}`,name:NAMES[i],
    currentPriceCents:price,currency:'EUR',
    pack:isPlus
      ? {amount:1000,unit:'ml',rawText:'1 l'}
      : {amount:500,unit:'ml',rawText:'500 ml'},
    offer:null,availability:'available',
    provenance:{
      supermarket:shop,kind:'product',
      url:isPlus ? `https://www.plus.nl/product/qa-${i}`
        : `https://www.dekamarkt.nl/producten/qa-${i}`,
      capturedAt:'2026-10-15T09:00:00.000Z',
      sha256:(i+1).toString(16).padStart(64,'0'),
    },
  }
}

function compare(observations) {
  return compareReviewedCatalogs({requirements,observations,nowMs:NOW})
}

test('11+11 independent mixed-price oracle: per-line and whole basket correct, no public claims',()=>{
  // Six DekaMarkt lines are cheaper; five more expensive. The *whole*
  // DekaMarkt basket is cheaper by only 15 fictional cents.
  const plus= NAMES.map((_,i)=>product('plus',i,130+i))
  const deka= NAMES.map((_,i)=>product('dekamarkt',i,(i%2===0?80:90)+i))
  const input=[...plus,...deka]
  const frozen=JSON.stringify(input)
  const result=compare(input)
  assert.equal(result.lines.length,11)
  assert.equal(result.comparable,true)
  assert.equal(result.stores.plus.complete,true)
  assert.equal(result.stores.dekamarkt.complete,true)
  let plusOracle=0, dekaOracle=0
  for(let i=0;i<11;i++){
    const line=result.lines[i]
    const plusExpected=2*(130+i)
    const dekaExpected=3*((i%2===0?80:90)+i)
    plusOracle+=plusExpected
    dekaOracle+=dekaExpected
    assert.equal(line.ingredientId,`ingredient-${i}`)
    assert.equal(line.plus.packs,2)
    assert.equal(line.dekamarkt.packs,3)
    assert.equal(line.plus.totalCents,plusExpected)
    assert.equal(line.dekamarkt.totalCents,dekaExpected)
    assert.equal(line.differenceCents,dekaExpected-plusExpected)
    assert.equal(line.plus.sourceUrl,plus[i].provenance.url)
    assert.equal(line.dekamarkt.sourceUrl,deka[i].provenance.url)
  }
  assert.equal(plusOracle,2970)
  assert.equal(dekaOracle,2955)
  assert.equal(result.stores.plus.subtotalCents,plusOracle)
  assert.equal(result.stores.dekamarkt.subtotalCents,dekaOracle)
  assert.equal(result.cheaperStore,'dekamarkt')
  assert.equal(result.savingsCents,15)
  assert.equal(result.provenance,'offline-snapshot-preview')
  assert.equal(result.claimable,false)
  assert.equal(JSON.stringify(input),frozen)
})

test('11+11 different pack sizes with equal complete baskets stays equal/zero',()=>{
  const inputs=NAMES.flatMap((_,i)=>[
    product('plus',i,150), product('dekamarkt',i,100),
  ])
  const result=compare(inputs)
  assert.equal(result.comparable,true)
  assert.equal(result.stores.plus.subtotalCents,3300)
  assert.equal(result.stores.dekamarkt.subtotalCents,3300)
  assert.equal(result.cheaperStore,'equal')
  assert.equal(result.savingsCents,0)
  assert.equal(result.claimable,false)
})

test('one missing or unavailable of 22 physical lines withdraws the entire 11-item winner',()=>{
  const inputs=NAMES.flatMap((_,i)=>[
    product('plus',i,150), product('dekamarkt',i,100),
  ])
  for (const changed of [
    inputs.filter(p=>!(p.supermarket==='dekamarkt'&&p.sourceProductId==='sku-8')),
    inputs.map(p=> p.supermarket==='dekamarkt'&&p.sourceProductId==='sku-8'
      ? {...p,availability:'unavailable'} : p),
  ]) {
    const result=compare(changed)
    assert.equal(result.lines.length,11)
    assert.equal(result.comparable,false)
    assert.equal(result.cheaperStore,null)
    assert.equal(result.savingsCents,null)
    assert.equal(result.lines[8].dekamarkt.totalCents,null)
    assert.equal(result.claimable,false)
  }
})
