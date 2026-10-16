import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const cli=fileURLToPath(new URL('../scraper/cli.mjs', import.meta.url))
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'supa-direct-crawl-deny-'))
  t.after(async()=>rm(dir,{recursive:true,force:true}))
  const dbPath=join(dir,'SHOULD-NOT-BE-CREATED.sqlite')
  const policyPath=join(dir,'fictional-policy.json')
  const gatePath=join(dir,'canonical.json')
  const gate=JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
    'utf8'))
  await writeFile(gatePath,JSON.stringify(gate))
  const policy={
    version:1, sources:[{
      id:'dirk',enabled:true,publicationApproved:true,
      scope:'public-product-prices',basis:'documented_legal_review',
      reviewedAt:new Date().toISOString().slice(0,10),
      evidenceUrl:'https://example.test/fictional-no-retailer-license',
      scopeNote:'Synthetic direct CLI safety test only; no actual permission.',
    }],
  }
  await writeFile(policyPath,JSON.stringify(policy))
  return {dir,dbPath,policyPath,gatePath,policy,gate}
}
function invoke(f,args,environment={}) {
  return spawnSync(process.execPath,[cli,...args,'--db',f.dbPath],{
    encoding:'utf8',timeout:10000,
    env:{...process.env,
      SUPA_SCRAPER_POLICY:f.policyPath,
      SUPA_SOURCE_PERMISSION_GATE:f.gatePath,
      ...environment},
  })
}
async function expectNoActivity(f,run) {
  assert.equal(run.status,1,run.stderr)
  assert.equal(run.stdout,'')
  assert.match(run.stderr,/Direct retailer scrape refused/)
  assert.doesNotMatch(run.stderr,/https?:\/\/|secret|token|permissionStatus/)
  await assert.rejects(stat(f.dbPath), {code:'ENOENT'})
}
test('no source policy blocks direct multi-retailer CLI BEFORE local database creation',async t=>{
  const f=await setup(t)
  const run=invoke(f,['scrape','--retailer','dirk','--limit','1'],
    {SUPA_SCRAPER_POLICY:''})
  await expectNoActivity(f,run)
})
test('default nine-adapter CLI cannot expand a single fictitious scoped approval',async t=>{
  const f=await setup(t)
  const run=invoke(f,['scrape','--limit','1'])
  await expectNoActivity(f,run)
})
test('an extra selected source outside reviewed policy is always blocked before HTTP',async t=>{
  const f=await setup(t)
  const run=invoke(f,['scrape','--retailer','dirk,spar','--limit','1'])
  await expectNoActivity(f,run)
})
test('no synthetically enabled PLUS policy overrides the real denied M1 permission registry',async t=>{
  const f=await setup(t)
  f.policy.sources[0].id='plus'
  await writeFile(f.policyPath,JSON.stringify(f.policy))
  const run=invoke(f,['scrape','--retailer','plus','--limit','1'])
  await expectNoActivity(f,run)
})
test('tampered canonical rights registry blocks even otherwise synthetically reviewed Dirk',async t=>{
  const f=await setup(t)
  delete f.gate.version
  await writeFile(f.gatePath,JSON.stringify(f.gate))
  const run=invoke(f,['scrape','--retailer','dirk','--limit','1'])
  await expectNoActivity(f,run)
})
test('invalid/expired fictional source policy blocks direct CLI before SQLite',async t=>{
  const f=await setup(t)
  f.policy.sources[0].reviewedAt='2020-01-01'
  await writeFile(f.policyPath,JSON.stringify(f.policy))
  const run=invoke(f,['scrape','--retailer','dirk','--limit','1'])
  await expectNoActivity(f,run)
})
test('offline no-network help CLI remains available without a source policy',()=>{
  const run=spawnSync(process.execPath,[cli,'help'],{
    encoding:'utf8',timeout:10000,
    env:{...process.env,SUPA_SCRAPER_POLICY:'',SUPA_SOURCE_PERMISSION_GATE:''},
  })
  assert.equal(run.status,0,run.stderr)
  assert.match(run.stdout,/node scraper\/cli\.mjs scrape/)
})
