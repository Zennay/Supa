import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'
import { renderPrivateShoppingChecklists } from '../scripts/retailer-private-shopping-checklist.mjs'

const row = (price, status='matched', packs=1, name='Fictieve halfvolle melk') => ({
  status, packs, packPriceCents:price,totalCents:price*packs,
  productName:name,productId:name,sourceUrl:'https://example.invalid/?private-token',
})
function report() {
  return {format:'supa-local-snapshot-comparison-v1',captureSummary:[],
    comparison:{provenance:'offline-snapshot-preview',claimable:false,
      comparable:true,cheaperStore:'dekamarkt',savingsCents:10,
      stores:{plus:{complete:true,subtotalCents:129},
        dekamarkt:{complete:true,subtotalCents:119}},
      lines:[{ingredientId:'milk',ingredient:'melk',plus:row(129),dekamarkt:row(119)}]}}
}
test('prints physical whole packs and a private total per retailer, never source URL tokens',()=>{
  const out=renderPrivateShoppingChecklists(report())
  assert.match(out,/PRIVÉ BOODSCHAPPENCHECKLIST/)
  assert.match(out,/€1,29\/pak/u)
  assert.match(out,/€1,19\/pak/u)
  assert.match(out,/1 hele verpakking/)
  assert.match(out,/ALLEEN OFFLINE TOTAAL PLUS: €1,29/)
  assert.match(out,/ALLEEN OFFLINE TOTAAL DekaMarkt: €1,19/)
  assert.doesNotMatch(out,/private-token|BEWEZEN BESPARING: €0,10/)
})
test('stock unknown and missing product never produce a complete total',()=>{
  const data=report()
  data.comparison.lines[0].dekamarkt.status='availability_unknown'
  const text=renderPrivateShoppingChecklists(data)
  assert.match(text,/prijs, product of voorraad onbekend/)
  assert.match(text,/GEEN BETROUWBAAR VOLLEDIG TOTAAL DekaMarkt/)
})
test('shared pack is charged once and never described as free',()=>{
  const data=report()
  data.comparison.stores.plus.subtotalCents=129
  data.comparison.stores.dekamarkt.subtotalCents=119
  data.comparison.lines[0].plus.sharedPackCoversIngredientIds=['milk','second-milk']
  data.comparison.lines[0].dekamarkt.sharedPackCoversIngredientIds=['milk','second-milk']
  data.comparison.lines.push({ingredientId:'second-milk',ingredient:'extra melk',
    plus:{...row(129),packs:0,totalCents:0,sharedPackWithIngredientId:'melk'},
    dekamarkt:{...row(119),packs:0,totalCents:0,sharedPackWithIngredientId:'melk'}})
  const text=renderPrivateShoppingChecklists(data)
  assert.match(text,/gedekt door eerder gedeeld pak; NIET gratis/)
  assert.equal(text.match(/€1,29\/pak/g)?.length,1)
  assert.match(text,/ALLEEN OFFLINE TOTAAL PLUS: €1,29/)
})
test('untrusted product name cannot inject terminal control or private source path',()=>{
  const data=report()
  const weird='Melk'+String.fromCharCode(27)+'[2J'+String.fromCharCode(0x202e)+'MALWARE'
  data.comparison.lines[0].plus.productName=weird
  const text=renderPrivateShoppingChecklists(data)
  assert.ok(!text.includes(String.fromCharCode(27)))
  assert.ok(!text.includes(String.fromCharCode(0x202e)))
  assert.match(text,/Melk/)
  assert.doesNotMatch(text,/private-token/)
})
test('forged root total or forged row cents withholds money headline',()=>{
  const data=report()
  data.comparison.stores.plus.subtotalCents=42
  assert.doesNotMatch(renderPrivateShoppingChecklists(data),/ALLEEN OFFLINE TOTAAL PLUS:/)
  data.comparison.stores.plus.subtotalCents=129
  data.comparison.lines[0].plus.totalCents=42
  assert.doesNotMatch(renderPrivateShoppingChecklists(data),/ALLEEN OFFLINE TOTAAL PLUS:/)
})
test('empty or claimable report is rejected',()=>{
  const data=report()
  data.comparison.lines=[]
  assert.throws(()=>renderPrivateShoppingChecklists(data),/Invalid or claimable/)
  data.comparison.lines=[{ingredientId:'milk',ingredient:'melk',plus:row(129),dekamarkt:row(119)}]
  data.comparison.claimable=true
  assert.throws(()=>renderPrivateShoppingChecklists(data),/Invalid or claimable/)
})
const html=price=>'<html><script type="application/ld+json">'+JSON.stringify({
  '@type':'Product',sku:'fictional-milk',name:'Fictional milk carton',
  weight:{value:'1000 ml'},offers:{'@type':'Offer',price,priceCurrency:'EUR',
    availability:'https://schema.org/InStock'}})+'</script></html>'
test('real offline local HTML -> comparator -> full-pack shopping checklist',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-pack-checklist-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(join(dir,'plus.html'),html('1.29'))
  await writeFile(join(dir,'deka.html'),html('1.19'))
  const manifest=join(dir,'manifest.json')
  await writeFile(manifest,JSON.stringify({version:1,
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    snapshots:[{sourceId:'plus-product-halfvolle-melk',htmlFile:'plus.html',
      capturedAt:'2026-10-15T10:00:00Z'},
      {sourceId:'dekamarkt-product-halfvolle-melk',htmlFile:'deka.html',
        capturedAt:'2026-10-15T10:00:00Z'}]}))
  const result=await compareLocalRetailerSnapshots(manifest,Date.parse('2026-10-15T11:00:00Z'))
  const text=renderPrivateShoppingChecklists(result)
  assert.match(text,/2 hele verpakking/)
  assert.match(text,/€2,58/)
  assert.match(text,/€2,38/)
  assert.match(text,/Fictional milk carton/)
  assert.match(text,/GEEN LIVE PRIJS/)
})

test('forged covered SKU without a paid owner is unknown rather than a free item',()=>{
  const data=report()
  data.comparison.lines[0].plus.packs=0
  data.comparison.lines[0].plus.totalCents=0
  data.comparison.lines[0].plus.sharedPackWithIngredientId='ghost-owner'
  data.comparison.stores.plus.subtotalCents=0
  const out=renderPrivateShoppingChecklists(data)
  assert.match(out,/gedeeld pak niet te bewijzen/)
  assert.doesNotMatch(out,/ALLEEN OFFLINE TOTAAL PLUS:/)
})
