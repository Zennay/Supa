import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'
import { renderPrivateComparison } from '../scripts/retailer-show-private-comparison.mjs'

// Full product-flow test from fictional HTML bytes -> parser -> exact pack
// prices -> full-basket comparison -> the new NL operator view. NO HTTP.
const capturedAt = '2026-10-15T10:00:00Z'
const nowMs = Date.parse('2026-10-15T11:00:00Z')
const makeHtml = (price, stock = 'InStock') => '<html><script type="application/ld+json">' +
  JSON.stringify({ '@type':'Product',sku:'fictional-milk',name:'Halfvolle melk',
    weight:{value:'1000 ml'},offers:{'@type':'Offer',price,
      priceCurrency:'EUR',availability:'https://schema.org/'+stock}}) +
  '</script></html>'

async function fixture(t, stock = 'InStock', requirements = [{id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}]) {
  const dir=await mkdtemp(join(tmpdir(),'supa-preview-fullflow-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),makeHtml('1.29'))
  await writeFile(join(dir,'deka.html'),makeHtml('1.19',stock))
  const file=join(dir,'manifest.json')
  await writeFile(file,JSON.stringify({version:1,
    requirements,
    snapshots:[
      {sourceId:'plus-product-halfvolle-melk',htmlFile:'plus.html',capturedAt},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',capturedAt},
    ],
  }))
  return file
}

test('actual offline M3 HTML parser to readable basket shows correctly costed physical packs',async t=>{
  const file=await fixture(t)
  const report=await compareLocalRetailerSnapshots(file,nowMs)
  assert.equal(report.comparison.comparable,true)
  assert.equal(report.comparison.savingsCents,10)
  assert.equal(report.comparison.claimable,false)
  assert.equal(report.captureSummary[0].capturedAt,capturedAt)
  const view=renderPrivateComparison(report)
  assert.match(view,/PLUS: 1 × €1,29 = €1,29/)
  assert.match(view,/DekaMarkt: 1 × €1,19 = €1,19/)
  assert.match(view,/ALLEEN OFFLINE MANDVERSCHIL: DekaMarkt lager €0,10/)
  assert.match(view,/GEEN GEVERIFIEERDE EUROBESPARING/)
})

test('actual offline M3 unstocked DekaMarkt HTML abstains from public and private total winner',async t=>{
  const file=await fixture(t,'OutOfStock')
  const report=await compareLocalRetailerSnapshots(file,nowMs)
  assert.equal(report.comparison.comparable,false)
  assert.equal(report.comparison.savingsCents,null)
  const view=renderPrivateComparison(report)
  assert.match(view,/GEEN VOLLEDIGE MANDVERGELIJKING/)
  assert.doesNotMatch(view,/ALLEEN OFFLINE MANDVERSCHIL/)
})

test('actual M3 operator view counts one physical pack shared across two ingredients only once',async t=>{
  const file=await fixture(t,'InStock',[
    {id:'breakfast-milk',query:'halfvolle melk',amount:400,unit:'ml'},
    {id:'dinner-milk',query:'halfvolle melk',amount:400,unit:'ml'},
  ])
  const report=await compareLocalRetailerSnapshots(file,nowMs)
  assert.equal(report.comparison.comparable,true)
  assert.equal(report.comparison.stores.plus.subtotalCents,129)
  assert.equal(report.comparison.stores.dekamarkt.subtotalCents,119)
  assert.equal(report.comparison.savingsCents,10)
  assert.equal(report.comparison.lines[1].plus.packs,0)
  const preview=renderPrivateComparison(report)
  assert.ok(preview.includes('onderdeel gedeeld pak (niet gratis)'))
  assert.match(preview,/ALLEEN OFFLINE MANDVERSCHIL: DekaMarkt lager €0,10/)
  assert.doesNotMatch(preview,/GEVERIFIEERDE EUROBESPARING: €0,10/)
})
