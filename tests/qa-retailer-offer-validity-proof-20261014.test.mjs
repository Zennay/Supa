import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

/** No external data or websites. Validity windows in these fixtures are fake. */
const CAPTURED='2026-10-15T09:00:00.000Z'
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const storeSrc={
  plus:SOURCES.find(x=>x.id==='plus-product-halfvolle-melk'),
  dekamarkt:SOURCES.find(x=>x.id==='dekamarkt-product-halfvolle-melk'),
}
const req=[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}]
const html=(price,validFrom,validTo)=>'<script type="application/ld+json">'+JSON.stringify({
  '@context':'https://schema.org','@type':'Product',
  name:'Halfvolle melk',sku:'mock-milk-1',weight:{value:'1000 ml'},
  offers:{'@type':'Offer',price,priceCurrency:'EUR',
    availability:'https://schema.org/InStock',
    validFrom,priceValidUntil:validTo},
})+'</script>'
const parse=(shop,price,validFrom,validTo)=>{
  const snapshot=parseOfflineRetailerSnapshot({
    source:storeSrc[shop],html:html(price,validFrom,validTo),
    capturedAt:CAPTURED,
  })
  assert.equal(snapshot.observations.length,1)
  return snapshot.observations[0]
}
const windowed=(dekaFrom,dekaUntil)=>{
  const plus=parse('plus','1.29','2026-10-14T00:00:00Z','2026-10-16T00:00:00Z')
  const deka=parse('dekamarkt','1.19',dekaFrom,dekaUntil)
  return {plus,deka}
}
const compare=(pair)=>compareReviewedCatalogs({
  requirements:req,observations:[pair.plus,pair.deka],nowMs:NOW,
})
function withhold(r) {
  assert.equal(r.comparable,false)
  assert.equal(r.claimable,false)
  assert.equal(r.cheaperStore,null)
  assert.equal(r.savingsCents,null)
}

test('two valid fictional same-time Offer windows preserve offline-only pack comparison',()=>{
  const r=compare(windowed('2026-10-14T00:00:00Z','2026-10-16T00:00:00Z'))
  assert.equal(r.comparable,true)
  assert.equal(r.claimable,false)
  assert.equal(r.stores.plus.subtotalCents,258)
  assert.equal(r.stores.dekamarkt.subtotalCents,238)
  assert.equal(r.savingsCents,20)
})

test('EXPECTED RED: expired Deka priceValidUntil cannot establish current cheaper basket',()=>{
  const r=compare(windowed('2026-09-01T00:00:00Z','2026-10-01T00:00:00Z'))
  withhold(r)
})

test('EXPECTED RED: Deka price validity starts tomorrow so current snapshot is not price evidence',()=>{
  const r=compare(windowed('2026-10-16T00:00:00Z','2026-10-20T00:00:00Z'))
  withhold(r)
})

test('EXPECTED RED: actual local HTML manifest must withhold cheapest store for expired Offer',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-stale-offer-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),
    html('1.29','2026-10-14T00:00:00Z','2026-10-16T00:00:00Z'))
  await writeFile(join(dir,'deka.html'),
    html('1.19','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z'))
  const manifest={version:1,requirements:req,snapshots:[
    {sourceId:storeSrc.plus.id,htmlFile:'plus.html',capturedAt:CAPTURED},
    {sourceId:storeSrc.dekamarkt.id,htmlFile:'deka.html',capturedAt:CAPTURED},
  ]}
  const file=join(dir,'manifest.json')
  await writeFile(file,JSON.stringify(manifest))
  const r=await compareLocalRetailerSnapshots(file,NOW)
  assert.deepEqual(r.captureSummary.map(x=>x.parsedProducts),[1,1])
  withhold(r.comparison)
})
