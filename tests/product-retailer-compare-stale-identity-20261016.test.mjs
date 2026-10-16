import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { getAdapter } from '../scraper/adapters/index.mjs'
import { compareApprovedLocalCatalog } from '../scraper/retailer-compare-approved.mjs'

// Entirely fictional policy, product identifiers, archive and prices.
const now=new Date('2026-10-16T12:00:00Z'), stamp=now.toISOString()
const ean='4006381333931'
async function setup(t,variant={}) {
  const dir=await mkdtemp(join(tmpdir(),'supa-compare-identity-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const dbPath=join(dir,'archive.sqlite'),policyPath=join(dir,'scoped.json')
  const gatePath=join(dir,'canonical.json')
  await writeFile(gatePath,await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json',import.meta.url),'utf8'))
  await writeFile(policyPath,JSON.stringify({
    version:1,sources:['dirk','spar'].map(id=>({
      id,enabled:true,publicationApproved:true,scope:'public-product-prices',
      basis:'documented_legal_review',reviewedAt:'2026-10-16',
      evidenceUrl:'https://example.test/fictional',scopeNote:'Offline mock only',
    })),
  }))
  const store=new ScrapeStore(dbPath)
  for(const id of ['dirk','spar'])store.upsertRetailer(getAdapter(id))
  const insert=(retailer,options={})=>store.saveRecord({
    retailer,sourceId:'fiction-cacao',
    url:retailer==='dirk'?'https://www.dirk.nl/producten/cacao':'https://www.spar.nl/producten/cacao',
    name:'Fictieve cacao',brand:'TEST',
    gtin:null,category:'synthetic',packText:'500 g',packAmount:500,
    packUnit:'g',packCount:1,imageUrl:null,
    priceCents:retailer==='dirk'?249:259,promoPriceCents:null,
    promoLabel:null,promoValidFrom:null,promoValidUntil:null,
    availability:'available',...options,
  },{at:stamp})
  const a=insert('dirk',variant.dirk),b=insert('spar',variant.spar)
  store.db.prepare('INSERT INTO canonical_products(id,name) VALUES (?,?)').run(19,'STALE canonical')
  const st=store.db.prepare('INSERT INTO product_matches(product_id,canonical_id,method,score,matched_at) VALUES (?,?,?,?,?)')
  for(const id of [a,b])st.run(id,19,'brand-name-pack',0.99,stamp)
  store.close()
  const output=[]
  const result=await compareApprovedLocalCatalog({query:'fictieve cacao',
    dbPath,policyPath,sourceGatePath:gatePath,now,write:s=>output.push(s)})
  return {result,output:output.join('\n')}
}
test('existing identical brand/name and physical pack remains a private candidate',async t=>{
  const d=await setup(t)
  assert.equal(d.result.displayedRows,2)
  assert.equal(d.result.publicPriceClaimsAllowed,false)
})
test('old canonical ID cannot equate physically equal but unrelated brands',async t=>{
  const d=await setup(t,{spar:{brand:'DIFFERENT'}})
  assert.equal(d.result.displayedRows,0)
  assert.doesNotMatch(d.output,/€\d/)
})
test('old canonical ID cannot equate 0 and 100 numeric product variants',async t=>{
  const d=await setup(t,{dirk:{name:'Fictieve cacao 0 procent'},
    spar:{name:'Fictieve cacao 100 procent'}})
  assert.equal(d.result.displayedRows,0)
  assert.doesNotMatch(d.output,/€\d/)
})
test('same EAN and equal physical pack may still match retailer-specific labels',async t=>{
  const d=await setup(t,{dirk:{gtin:ean,name:'Fictieve cacao licht',brand:'TEST'},
    spar:{gtin:ean,name:'Fictieve cacao donker',brand:'OTHER'}})
  assert.equal(d.result.displayedRows,2)
  assert.equal(d.result.historicalFieldSavingsProven,false)
})
