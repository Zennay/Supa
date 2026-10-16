import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { reviewedRetailerIds } from '../scraper/daily-source-policy.mjs'
import { permittedDailyIds, runDailyRefresh } from '../scraper/daily-refresh.mjs'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { handleRetailerSearch, findFreshProducts } from '../scraper/retailer-search-api.mjs'
import { getAdapter } from '../scraper/adapters/index.mjs'

const now = new Date('2026-10-16T10:00:00.000Z')
const approved = (id='dirk') => ({
  id, enabled:true, publicationApproved:true,
  scope:'public-product-prices',
  basis:'documented_legal_review',
  reviewedAt:'2026-10-16',
  evidenceUrl:'https://example.test/legal-review',
  scopeNote:'Fictional scoped legal review FOR TESTS ONLY, not real permissions.',
})
// Use the real, versioned, still-DENIED canonical source permission document.
// A partial fake no longer tests the intended daily authorization behavior:
// strict version/milestone/HTTPS evidence validation correctly rejects it first.
const defaultGate = JSON.parse(readFileSync(
  new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
  'utf8',
))
async function temp(t){
  const dir=await mkdtemp(join(tmpdir(),'supa-retailer-live-ui-'))
  t.after(async()=>await rm(dir,{recursive:true,force:true}))
  return dir
}
function fixtureStore(path){
  const db=new ScrapeStore(path)
  db.upsertRetailer(getAdapter('dirk'))
  const at=now.toISOString()
  db.saveRecord({
    retailer:'dirk',sourceId:'12345',
    name:'Test Pindakaas 500g',brand:'Test',url:'https://www.dirk.nl/producten/test-pindakaas-12345',
    category:'Test',packText:'500 g',packAmount:500,packUnit:'g',packCount:1,
    imageUrl:null,gtin:null,extraGtins:[],priceCents:249,promoPriceCents:199,
    promoLabel:'Testactie',promoValidFrom:null,promoValidUntil:'2026-10-17T10:00:00.000Z',
    availability:'available',
  },{at})
  db.close()
}

test('default source policy is disabled; a valid reviewed non-written basis is allowed as a project option', () => {
  assert.deepEqual(reviewedRetailerIds({version:1,sources:[
    {id:'dirk',enabled:false,publicationApproved:false},
    {id:'spar',enabled:false,publicationApproved:false},
  ]},now),[])
  assert.deepEqual(reviewedRetailerIds({version:1,sources:[approved()]},now),['dirk'])
})

test('blocked source and unreviewed/rejected license can never turn on a daily crawl', () => {
  for (const source of [
    approved('ah'),{...approved(),evidenceUrl:null},
    {...approved(),basis:'unverified_public'},
    {...approved(),scope:'entire-retailer-database'},
    {...approved(),publicationApproved:false},
    {...approved(),reviewedAt:'2020-01-01'},
  ]) {
    assert.throws(()=>reviewedRetailerIds({version:1,sources:[source]},now))
  }
})

test('PLUS and Deka canonical source rights remain blocked EVEN with a separate synthetic approval', () => {
  for (const id of ['plus','dekamarkt']) {
    assert.throws(()=>permittedDailyIds({version:1,sources:[approved(id)]},defaultGate,now),
      /Canonical PLUS\/Deka project source gate blocks/)
  }
})

test('daily supervisor performs zero retailer requests when no reviewed source exists',async t=>{
  const dir=await temp(t)
  const file=join(dir,'sources.json')
  const rights=join(dir,'source-gate.json')
  await writeFile(file,JSON.stringify({version:1,sources:[
    {id:'dirk',enabled:false,publicationApproved:false},
  ]}))
  await writeFile(rights,JSON.stringify(defaultGate))
  let calls=0
  const result=await runDailyRefresh({policyPath:file,sourceGatePath:rights,
    dbPath:join(dir,'retail.sqlite'),now,runner:async()=>{calls++}})
  assert.equal(calls,0)
  assert.equal(result.status,'disabled-no-reviewed-sources')
})

test('reviewed supported source uses existing retailer scraper CLI; arguments are exact',async t=>{
  const dir=await temp(t)
  const file=join(dir,'sources.json')
  const rights=join(dir,'source-gate.json')
  await writeFile(file,JSON.stringify({version:1,sources:[approved('dirk')]}))
  await writeFile(rights,JSON.stringify(defaultGate))
  const commands=[]
  await runDailyRefresh({policyPath:file,sourceGatePath:rights,
    dbPath:join(dir,'retail.sqlite'),now,
    runner:async (command,args)=>{commands.push({command,args})}})
  assert.equal(commands.length,1)
  assert.deepEqual(commands[0].args.slice(0,4),[
    'scraper/cli.mjs','scrape','--retailer','dirk'])
  assert.ok(commands[0].args.includes('--skip-fresh'))
})

test('search API exposes fresh reviewed SQLite prices, never fixture or unapproved stores',async t=>{
  const dir=await temp(t)
  const file=join(dir,'sources.json'),db=join(dir,'catalog.sqlite')
  fixtureStore(db)
  await writeFile(file,JSON.stringify({version:1,sources:[approved('dirk')]}))
  const res=await handleRetailerSearch('/api/retailer-products?q=pindakaas',{
    dbPath:db,policyPath:file,now})
  assert.equal(res.status,200)
  assert.equal(res.body.results.length,1)
  const row=res.body.results[0]
  assert.equal(row.priceCents,199)
  assert.equal(row.regularPriceCents,249)
  assert.equal(row.offer,true)
  assert.equal(row.supermarket,'dirk')
  assert.equal(row.observedAt,now.toISOString())
  assert.equal(row.sourceUrl,'https://www.dirk.nl/producten/test-pindakaas-12345')

  const stale=await handleRetailerSearch('/api/retailer-products?q=pindakaas',{
    dbPath:db,policyPath:file,now:new Date(now.getTime()+24*3600_000+2000)})
  assert.deepEqual(stale.body.results,[])

  const injection=await handleRetailerSearch(
    '/api/retailer-products?q='+encodeURIComponent("%' OR 1=1 --"),{
      dbPath:db,policyPath:file,now})
  assert.equal(injection.status,200)
  assert.deepEqual(injection.body.results,[])

  const missing=await handleRetailerSearch('/api/retailer-products?q=x',{
    dbPath:db,policyPath:file,now})
  assert.equal(missing.status,400)

  await writeFile(file,JSON.stringify({version:1,sources:[{
    id:'dirk',enabled:false,publicationApproved:false,
  }]}))
  const denied=await handleRetailerSearch('/api/retailer-products?q=pindakaas',{
    dbPath:db,policyPath:file,now})
  assert.equal(denied.body.availability,'sources-not-approved')
  assert.deepEqual(denied.body.results,[])
})

test('service refuses unknown store IDs and never creates a price by guessing', () => {
  assert.deepEqual(findFreshProducts({prepare:()=>{throw Error('MUST NOT QUERY')}},['unknown'],'melk',now),[])
  assert.deepEqual(findFreshProducts({prepare:()=>{throw Error('MUST NOT QUERY')}},[], 'melk',now),[])
})
