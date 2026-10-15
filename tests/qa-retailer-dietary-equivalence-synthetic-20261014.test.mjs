import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matchIngredient } from '../src/domain/matching.ts'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

/** All product names/prices/permissions below are fictional fixtures.
 * There is no live retailer access and no medical/dietary suitability claim. */
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const CAPTURED='2026-10-15T09:00:00.000Z'
function requirement(name, amount=400, unit='g') {
  return {id:'meat',query:name,amount,unit}
}
function observation(shop,name,id='sku1',cents=299,amount=400,unit='g') {
  return {
    supermarket:shop,sourceProductId:id,name,currentPriceCents:cents,
    currency:'EUR',pack:{amount,unit,rawText:`${amount} ${unit}`},
    availability:'available',offer:null,
    provenance:{
      supermarket:shop,kind:'product',
      url:shop==='plus'?'https://www.plus.nl/product/fixture':
        'https://www.dekamarkt.nl/producten/fixture',
      capturedAt:CAPTURED,sha256:'a'.repeat(64),
    },
  }
}
function compare(name, plusName, dekaName) {
  return compareReviewedCatalogs({
    requirements:[requirement(name)],
    observations:[
      observation('plus',plusName,'a',299),
      observation('dekamarkt',dekaName,'b',199),
    ],
    nowMs:NOW,
  })
}
function expectWithheld(r) {
  assert.equal(r.claimable,false)
  assert.equal(r.provenance,'offline-snapshot-preview')
  assert.equal(r.comparable,false,'dietary-incompatible SKU cannot establish same-demand shopping winner')
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
}

test('explicitly same meat product name in both shops preserves cents and complete same-demand result',()=>{
  const r=compare('rundergehakt','Rundergehakt','Rundergehakt')
  assert.equal(r.comparable,true)
  assert.equal(r.claimable,false)
  assert.equal(r.stores.plus.subtotalCents,299)
  assert.equal(r.stores.dekamarkt.subtotalCents,199)
  assert.equal(r.savingsCents,100)
})

test('EXPECTED RED: meat requirement must not count vegan rundergehakt as exact animal rundergehakt',()=>{
  const r=compare('rundergehakt','Rundergehakt','Vegetarisch rundergehakt')
  expectWithheld(r)
})

test('EXPECTED RED: chicken requirement must not count vegan kipfilet as the same meat product',()=>{
  const r=compare('kipfilet','Kipfilet','Vegan kipfilet')
  expectWithheld(r)
})

test('EXPECTED RED: raw matcher must abstain on lone explicit vegan alternative to non-vegan meat',()=>{
  const r=matchIngredient(requirement('rundergehakt'),[
    {id:'v',name:'Vegetarisch rundergehakt',packAmount:400,packUnit:'g',packCount:1,available:true},
  ])
  assert.equal(r.type,'abstain','a matched word is not proof of same dietary product')
})

const html=(name,price)=>'<script type="application/ld+json">'+JSON.stringify({
  '@context':'https://schema.org','@type':'Product',
  sku:'meat-fixture',name,weight:{value:'400 g'},
  offers:{'@type':'Offer',price,priceCurrency:'EUR',
    availability:'https://schema.org/InStock'},
})+'</script>'

test('EXPECTED RED: real local PLUS/Deka HTML manifest cannot compare conventional and vegan meats',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-dietary-equivalence-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),html('Rundergehakt','2.99'))
  await writeFile(join(dir,'deka.html'),html('Vegetarisch rundergehakt','1.99'))
  const manifest={
    version:1,requirements:[requirement('rundergehakt')],
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'plus.html',capturedAt:CAPTURED},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',capturedAt:CAPTURED},
    ],
  }
  const filename=join(dir,'manifest.json')
  await writeFile(filename,JSON.stringify(manifest))
  const r=await compareLocalRetailerSnapshots(filename,NOW)
  assert.deepEqual(r.captureSummary.map(x=>x.parsedProducts),[1,1])
  expectWithheld(r.comparison)
})
