import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

/** Physical pack pooling across distinct ingredient IDs that resolve to the
 * same SKU. All prices, sources and rights below are fictional. */
const nowMs=Date.parse('2026-10-15T10:00:00.000Z')
const capturedAt='2026-10-15T09:00:00.000Z'
const one = (shop, price) => ({
  supermarket:shop,
  sourceProductId:'milk-1',
  name:'Halfvolle melk',
  currentPriceCents:price,
  currency:'EUR',
  pack:{amount:1000,unit:'ml',rawText:'1 l'},
  offer:null, availability:'available',
  provenance:{
    supermarket:shop,kind:'product',
    url:shop==='plus'
      ? 'https://www.plus.nl/product/fictional-milk'
      : 'https://www.dekamarkt.nl/producten/fictional-milk',
    capturedAt,sha256:'d'.repeat(64),
  },
})
const data=()=>[one('plus',129),one('dekamarkt',119)]
const combined=[{id:'milk',query:'halfvolle melk',amount:800,unit:'ml'}]
const split=[
  {id:'breakfast-milk',query:'halfvolle melk',amount:400,unit:'ml'},
  {id:'dinner-milk',query:'halfvolle melk',amount:400,unit:'ml'},
]
const assess=(requirements,observations=data())=>
  compareReviewedCatalogs({requirements,observations,nowMs})

function assertSafePhysicalCost(result) {
  assert.equal(result.provenance,'offline-snapshot-preview')
  assert.equal(result.claimable,false)
  if (!result.comparable) {
    assert.equal(result.cheaperStore,null)
    assert.equal(result.savingsCents,null)
  } else {
    // Two 400-ml demands for the *same* SKU fit in ONE 1-liter package.
    // Allow safe pooled totals, or abstain. Never quote two paid packages.
    assert.equal(result.stores.plus.subtotalCents,129)
    assert.equal(result.stores.dekamarkt.subtotalCents,119)
    assert.equal(result.cheaperStore,'dekamarkt')
    assert.equal(result.savingsCents,10)
  }
}

test('single canonically aggregated 800ml ingredient costs exactly one whole liter pack',()=>{
  const result=assess(combined)
  assert.equal(result.comparable,true)
  assert.equal(result.lines[0].plus.packs,1)
  assert.equal(result.lines[0].dekamarkt.packs,1)
  assertSafePhysicalCost(result)
})

test('EXPECTED RED: two distinct ingredient IDs sharing one SKU cannot separately round the same one-liter package',()=>{
  const original=data()
  const before=JSON.stringify(original)
  const result=assess(split,original)
  assertSafePhysicalCost(result)
  assert.equal(JSON.stringify(original),before)
})

test('EXPECTED RED: equivalent split 0.4l + 400ml cannot charge 2 packs for one shared SKU',()=>{
  const requirement=[
    {...split[0],amount:0.4,unit:'l'},
    split[1],
  ]
  const result=assess(requirement)
  assertSafePhysicalCost(result)
})

const productHtml=(price)=>'<script type="application/ld+json">'+JSON.stringify({
  '@type':'Product',sku:'milk-1',name:'Halfvolle melk',
  weight:{value:'1000 ml'},
  offers:{
    '@type':'Offer',price,priceCurrency:'EUR',
    availability:'https://schema.org/InStock',
  },
})+'</script>'

test('EXPECTED RED: real two-store HTML manifest must not double-price physically pooled split milk demands',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-same-sku-pool-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),productHtml('1.29'))
  await writeFile(join(dir,'deka.html'),productHtml('1.19'))
  const manifest={
    version:1,requirements:split,
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'plus.html',capturedAt},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',capturedAt},
    ],
  }
  const input=join(dir,'manifest.json')
  await writeFile(input,JSON.stringify(manifest))
  const result=await compareLocalRetailerSnapshots(input,nowMs)
  assert.equal(result.captureSummary[0].parsedProducts,1)
  assert.equal(result.captureSummary[1].parsedProducts,1)
  assertSafePhysicalCost(result.comparison)
  assert.equal(result.comparison.claimable,false)
})
