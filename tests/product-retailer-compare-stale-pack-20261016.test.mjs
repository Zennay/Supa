import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { getAdapter } from '../scraper/adapters/index.mjs'
import { compareApprovedLocalCatalog } from '../scraper/retailer-compare-approved.mjs'

// Private, fictional, on-disk SQLITE. No external retailer HTTP nor actual
// source permissions; canonical M1 PLUS rights always remain denied.
const clock=new Date('2026-10-16T12:00:00Z')
const stamp=clock.toISOString()
async function fixture(t, mutate=()=>{}) {
  const dir=await mkdtemp(join(tmpdir(),'supa-stale-match-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const dbPath=join(dir,'archive.sqlite')
  const policyPath=join(dir,'policy.json')
  const sourceGatePath=join(dir,'gate.json')
  const canonical=await readFile(new URL('../evidence/m1/source-permission-gate.v1.json',import.meta.url),'utf8')
  await writeFile(sourceGatePath,canonical)
  await writeFile(policyPath,JSON.stringify({
    version:1,sources:['dirk','spar'].map(id=>({
      id,enabled:true,publicationApproved:true,scope:'public-product-prices',
      basis:'documented_legal_review',reviewedAt:'2026-10-16',
      evidenceUrl:'https://example.test/fictional-review',
      scopeNote:'Offline fictional approval only; no live source grant',
    })),
  }))
  const db=new ScrapeStore(dbPath)
  for(const id of ['dirk','spar'])db.upsertRetailer(getAdapter(id))
  function add(retailer,amount=500,count=1,urlSuffix='cacao') {
    return db.saveRecord({
      retailer,sourceId:'fiction-'+urlSuffix,
      url:retailer==='dirk' ? 'https://www.dirk.nl/producten/'+urlSuffix :
        'https://www.spar.nl/producten/'+urlSuffix,
      name:'Fictieve cacao',brand:'TEST',category:'fictional',
      packText:amount+' g',packAmount:amount,packUnit:'g',
      packCount:count,gtin:null,imageUrl:null,
      priceCents:retailer==='dirk'?249:259,promoPriceCents:null,
      promoLabel:null,promoValidFrom:null,promoValidUntil:null,
      availability:'available',
    },{at:stamp})
  }
  const a=add('dirk'),b=add('spar')
  db.db.prepare('INSERT INTO canonical_products(id,name) VALUES (?,?)').run(19,'Fictieve cacao')
  const insert=db.db.prepare('INSERT INTO product_matches(product_id,canonical_id,method,score,matched_at) VALUES (?,?,?,?,?)')
  for(const id of [a,b])insert.run(id,19,'gtin',1,stamp)
  mutate(db,{a,b,add,insert})
  db.close()
  return {dbPath,policyPath,sourceGatePath}
}
async function inspect(f) {
  const lines=[]
  const result=await compareApprovedLocalCatalog({
    query:'fictieve cacao',dbPath:f.dbPath,policyPath:f.policyPath,
    sourceGatePath:f.sourceGatePath,now:clock,write:s=>lines.push(s),
  })
  return {result,text:lines.join('\n')}
}
test('two fresh equal physical 500g packs remain eligible for private comparison', async t=>{
  const out=await inspect(await fixture(t))
  assert.equal(out.result.displayedRows,2)
  assert.match(out.text,/dirk: Fictieve cacao €2.49/)
  assert.match(out.text,/spar: Fictieve cacao €2.59/)
  assert.equal(out.result.publicPriceClaimsAllowed,false)
})
test('stale stored canonical ID cannot equate 500g and 504g whole-pack prices', async t=>{
  const out=await inspect(await fixture(t,(db,{b})=>
    db.db.prepare('UPDATE products SET pack_amount=504,pack_text=? WHERE id=?').run('504 g',b)))
  assert.equal(out.result.displayedRows,0)
  assert.doesNotMatch(out.text,/€\d/)
})
test('stale matched 1×500g and 2×250g cannot expose fictional prices', async t=>{
  const out=await inspect(await fixture(t,(db,{b})=>
    db.db.prepare('UPDATE products SET pack_amount=250,pack_count=2,pack_text=? WHERE id=?').run('250 g',b)))
  assert.equal(out.result.matchedGroups,0)
  assert.doesNotMatch(out.text,/€\d/)
})
test('a stale same-canonical gram-versus-ml mismatch cannot show prices', async t=>{
  const out=await inspect(await fixture(t,(db,{b})=>
    db.db.prepare('UPDATE products SET pack_unit=?,pack_text=? WHERE id=?').run('ml','500 ml',b)))
  assert.equal(out.result.displayedRows,0)
  assert.doesNotMatch(out.text,/€\d/)
})
test('a fractional legacy multipack count cannot authorize stored price equivalence', async t=>{
  const out=await inspect(await fixture(t,(db,{b})=>
    db.db.prepare('UPDATE products SET pack_count=? WHERE id=?').run(1.5,b)))
  assert.equal(out.result.displayedRows,0)
  assert.doesNotMatch(out.text,/€\d/)
})
test('missing physical dimensions abstain before any individual price text', async t=>{
  const out=await inspect(await fixture(t,(db,{b})=>
    db.db.prepare('UPDATE products SET pack_amount=NULL WHERE id=?').run(b)))
  assert.equal(out.result.displayedRows,0)
  assert.doesNotMatch(out.text,/€\d/)
})
test('an ambiguous ranged pack label cannot be considered a known identical pack',async t=>{
  const out=await inspect(await fixture(t,(db,{b})=>
    db.db.prepare('UPDATE products SET pack_text=? WHERE id=?').run('500-504 g',b)))
  assert.equal(out.result.displayedRows,0)
  assert.doesNotMatch(out.text,/€\d/)
})
test('duplicate same-store canonical product rows also make comparison ambiguous',async t=>{
  const out=await inspect(await fixture(t,(db,{add,insert})=>{
    const duplicate=add('dirk',500,1,'cacao-duplicate')
    insert.run(duplicate,19,'gtin',1,stamp)
  }))
  assert.equal(out.result.displayedRows,0)
  assert.doesNotMatch(out.text,/€\d/)
})
