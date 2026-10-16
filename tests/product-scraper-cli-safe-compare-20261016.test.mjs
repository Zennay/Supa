import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { getAdapter } from '../scraper/adapters/index.mjs'
import { compareApprovedLocalCatalog } from '../scraper/retailer-compare-approved.mjs'

// All price and permission facts in this test are fictional and OFFLINE.
const now = new Date('2026-10-16T12:00:00.000Z')
const stamp = now.toISOString()
const date = '2026-10-16'
const policy = ids => ({
  version:1, sources:ids.map(id=>({
    id, enabled:true, publicationApproved:true,
    scope:'public-product-prices', basis:'documented_legal_review',
    reviewedAt:date, evidenceUrl:'https://example.test/fictional-review',
    scopeNote:'Synthetic approval for in-memory tests; never actual rights.',
  })),
})
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-compare-guard-'))
  t.after(async() => rm(dir, {recursive:true,force:true}))
  const dbPath = join(dir,'local.sqlite')
  const policyPath = join(dir,'source-policy.json')
  const gatePath = join(dir,'canonical.json')
  const gate = await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
    'utf8')
  await writeFile(gatePath, gate)
  await writeFile(policyPath, JSON.stringify(policy(['dirk','spar'])))
  const store = new ScrapeStore(dbPath)
  store.upsertRetailer(getAdapter('dirk'))
  store.upsertRetailer(getAdapter('spar'))
  function record(retailer, patch={}) {
    return {
      retailer, sourceId:'FICTION-CHOCOLATE-500',
      url: retailer === 'dirk'
        ? 'https://www.dirk.nl/producten/private-cacao'
        : 'https://www.spar.nl/producten/private-cacao',
      name:'Fictieve cacao 500g', brand:'TEST',
      category:'Nonreal', packText:'500 g',packAmount:500,
      packUnit:'g',packCount:1,gtin:null,extraGtins:[],
      imageUrl:null,priceCents:retailer==='dirk'?249:259,
      promoPriceCents:retailer==='dirk'?99:null,
      promoLabel:retailer==='dirk'?'Fictional promo':null,
      promoValidFrom:retailer==='dirk'?'2026-10-16T11:00:00.000Z':null,
      promoValidUntil:retailer==='dirk'?'2026-10-16T14:00:00.000Z':null,
      availability:'available', ...patch,
    }
  }
  const a=store.saveRecord(record('dirk'),{at:stamp})
  const b=store.saveRecord(record('spar'),{at:stamp})
  store.db.prepare('INSERT INTO canonical_products(id,name) VALUES (?,?)')
    .run(19,'Fictieve cacao 500g')
  for (const id of [a,b]) {
    store.db.prepare(
      'INSERT INTO product_matches(product_id,canonical_id,method,score,matched_at) '+
      'VALUES (?,?,?,?,?)').run(id,19,'brand-name-pack',0.98,stamp)
  }
  store.close()
  return {dir,dbPath,policyPath,gatePath,record}
}
async function preview(f, clock=now) {
  const lines=[]
  const result=await compareApprovedLocalCatalog({
    query:'fictieve cacao',dbPath:f.dbPath,policyPath:f.policyPath,
    sourceGatePath:f.gatePath,now:clock,write:line=>lines.push(line),
  })
  return {lines,text:lines.join('\n'),result}
}
test('operator CLI preview shows only TWO policy-approved fresh match rows, never basket savings',async t=>{
  const f=await fixture(t)
  const {result,text}=await preview(f)
  assert.equal(result.matchedGroups,1)
  assert.equal(result.displayedRows,2)
  assert.equal(result.approvedSourceCount,2)
  assert.equal(result.publicPriceClaimsAllowed,false)
  assert.equal(result.historicalFieldSavingsProven,false)
  assert.match(text,/SUPA PRIVÉ/)
  assert.match(text,/GEEN veldmand of bewezen besparing/)
  assert.match(text,/dirk: Fictieve cacao 500g €0.99/)
  assert.match(text,/spar: Fictieve cacao 500g €2.59/)
  assert.match(text,/normaal €2.49/)
  assert.doesNotMatch(text,/sourceUrl|https?:\/\//)
})
test('CLI refuses malformed or missing policy before it can create or open SQLite',async t=>{
  const f=await fixture(t)
  const phantom=join(f.dir,'must-not-create.sqlite')
  await assert.rejects(compareApprovedLocalCatalog({
    query:'fictieve cacao',dbPath:phantom,policyPath:'',
    sourceGatePath:f.gatePath,now,
  }),/comparison refused/)
  await assert.rejects(compareApprovedLocalCatalog({
    query:'fictieve cacao',dbPath:phantom,policyPath:join(f.dir,'missing.json'),
    sourceGatePath:f.gatePath,now,
  }),/comparison refused/)
  await assert.rejects(stat(phantom), {code:'ENOENT'})
})
test('no per-store fictional PLUS permission may bypass real canonical M1 denial', async t=>{
  const f=await fixture(t)
  await writeFile(f.policyPath,JSON.stringify(policy(['plus'])))
  const output=[]
  await assert.rejects(compareApprovedLocalCatalog({
    query:'fictieve cacao',dbPath:f.dbPath,policyPath:f.policyPath,
    sourceGatePath:f.gatePath,now,write:s=>output.push(s),
  }),/comparison refused/)
  assert.deepEqual(output,[])
})
test('unapproved second supermarket or unknown stock blocks comparisons completely',async t=>{
  const f=await fixture(t)
  await writeFile(f.policyPath,JSON.stringify(policy(['dirk'])))
  const one=await preview(f)
  assert.equal(one.result.displayedRows,0)
  assert.doesNotMatch(one.text,/€\d/)
  const db=new ScrapeStore(f.dbPath)
  db.saveRecord(f.record('spar',{availability:'unknown',promoPriceCents:null,
    promoValidFrom:null,promoValidUntil:null}),{at:stamp})
  db.close()
  await writeFile(f.policyPath,JSON.stringify(policy(['dirk','spar'])))
  const two=await preview(f)
  assert.equal(two.result.displayedRows,0)
  assert.doesNotMatch(two.text,/€\d/)
})
test('future-starting fictional discount cannot leak through historical SQL effective price',async t=>{
  const f=await fixture(t)
  const db=new ScrapeStore(f.dbPath)
  db.saveRecord(f.record('dirk',{promoValidFrom:'2026-10-16T12:00:00.000000001Z'}),
    {at:stamp})
  db.close()
  const {text,result}=await preview(f)
  assert.equal(result.matchedGroups,1)
  assert.equal(result.displayedRows,2)
  assert.match(text,/dirk: Fictieve cacao 500g €2.49/)
  assert.doesNotMatch(text,/€0.99/)
})
test('real child CLI command is denied by default, even if local DB has fictional prices',async t=>{
  const f=await fixture(t)
  const cli=fileURLToPath(new URL('../scraper/cli.mjs', import.meta.url))
  const denied=spawnSync(process.execPath,[cli,'compare','fictieve','--db',f.dbPath],{
    encoding:'utf8',timeout:30000,
    env:{...process.env,SUPA_SCRAPER_POLICY:'',SUPA_SOURCE_PERMISSION_GATE:f.gatePath},
  })
  assert.equal(denied.status,1)
  assert.equal(denied.stdout,'')
  assert.match(denied.stderr,/comparison refused/)
  assert.doesNotMatch(denied.stderr,/cacao|€|https?:\/\//)
  const allowed=spawnSync(process.execPath,[cli,'compare','fictieve','cacao','--db',f.dbPath],{
    encoding:'utf8',timeout:30000,
    env:{...process.env,SUPA_SCRAPER_POLICY:f.policyPath,SUPA_SOURCE_PERMISSION_GATE:f.gatePath},
  })
  assert.equal(allowed.status,0,allowed.stderr)
  assert.match(allowed.stdout,/dirk: Fictieve cacao 500g €0.99/)
  assert.match(allowed.stdout,/spar: Fictieve cacao 500g €2.59/)
})
