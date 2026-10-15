import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { writePrivateRetailerCatalog } from '../scripts/retailer-private-catalog-store.mjs'
import { comparePrivateRetailerCatalogs } from '../scripts/retailer-private-catalog-drift.mjs'

async function original() {
  return buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
}
function nextCapture(catalog,{ changedFact = false }={}) {
  const product = catalog.products.find(p => p.consistency === 'consistent')
  assert.ok(product, 'a known reviewed source should be consistent')
  const source = product.captures[0]
  const fresh = structuredClone(source)
  fresh.capturedAt = '2026-10-15T12:00:00.000Z'
  if (fresh.capturedAt === source.capturedAt) fresh.capturedAt = '2026-10-15T12:00:01.000Z'
  if (changedFact) {
    fresh.availability = source.availability === 'unknown' ? 'available' : 'unknown'
    product.consistency = 'review-required'
    catalog.conflictCount++
  }
  product.captures.push(fresh)
  catalog.captureCount++
  return product
}
async function isolated(fn) {
  const folder = await mkdtemp(join(tmpdir(),'supa-drift-offline-'))
  try { return await fn(folder) } finally { await rm(folder,{recursive:true,force:true}) }
}
const run = (...args) => spawnSync(process.execPath,
  ['--experimental-strip-types',new URL('../scripts/retailer-private-catalog-drift.mjs',import.meta.url).pathname,...args],
  {encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024})

test('real six-source offline catalogs compare as identical without price/source disclosure',async()=>{
  const a=await original()
  assert.equal(a.sourceCount,6)
  const result=comparePrivateRetailerCatalogs(a,structuredClone(a))
  assert.equal(result.mode,'private-historical-retailer-drift-review')
  assert.equal(result.repeatedCaptureEvents,a.captureCount)
  assert.equal(result.newCaptureEvents,0)
  assert.equal(result.factSetChangesNeedingReview,0)
  assert.equal(result.publicSavingsClaimEligible,false)
  assert.equal(result.livePricesAvailable,false)
  assert.equal(result.externalRequests,0)
  assert.doesNotMatch(JSON.stringify(result),/sourceUrl|capturedAt|productName|retailerProductId|currentPriceCents|offerPriceCents|www\./)
})

test('revisiting same historical HTML at a new UTC instant is a NEW capture event, not a new fact',async()=>{
  const before=await original()
  const after=structuredClone(before)
  nextCapture(after)
  const report=comparePrivateRetailerCatalogs(before,after)
  assert.equal(report.newCaptureEvents,1)
  assert.equal(report.factSetChangesNeedingReview,0)
  assert.equal(report.repeatedCaptureEvents,before.captureCount)
  assert.equal(report.missingCaptureEventsInCandidateDataset,0)
})

test('changed historical facts require human review, never price publication',async()=>{
  const before=await original()
  const after=structuredClone(before)
  const product=nextCapture(after,{changedFact:true})
  const report=comparePrivateRetailerCatalogs(before,after)
  assert.equal(report.newCaptureEvents,1)
  assert.equal(report.factSetChangesNeedingReview,1)
  assert.equal(report.inconsistentProductHistories,before.conflictCount+1)
  assert.equal(report.perRetailer[product.retailerId].factSetChangesNeedingReview,1)
  assert.equal(report.publicSavingsClaimEligible,false)
})

test('missing capture/product means missing from THIS dataset, not actual store delisting',async()=>{
  const before=await original()
  const after=structuredClone(before)
  const lost=after.products.pop()
  after.productCount--
  after.captureCount-=lost.captures.length
  if(lost.consistency==='review-required')after.conflictCount--
  const report=comparePrivateRetailerCatalogs(before,after)
  assert.equal(report.missingProductIdsInCandidateDataset,1)
  assert.equal(report.missingCaptureEventsInCandidateDataset,lost.captures.length)
  assert.equal(report.productionEnabled,false)
  assert.ok(!('retailerAvailability' in report))
})

test('the same immutable source event must not have rewritten facts',async()=>{
  const before=await original()
  const after=structuredClone(before)
  const product=after.products.find(p=>p.consistency==='consistent')
  product.captures[0].name+=' altered'
  assert.throws(()=>comparePrivateRetailerCatalogs(before,after),/refused/)
})

test('forged publication, secret URL, impossible timestamp and unsafe cent values are rejected',async()=>{
  const before=await original()
  const scenarios=[
    after=>{after.products[0].publishable=true},
    after=>{after.products[0].sourceRightsVerified=true},
    after=>{after.products[0].captures[0].sourceUrl='https://USER:FAKE_SECRET@www.plus.nl/items'},
    after=>{after.products[0].captures[0].capturedAt='2035-01-01T00:00:00Z'},
    after=>{after.products[0].captures[0].currentPriceCents=Number.MAX_SAFE_INTEGER+1},
    after=>{after.publicSavingsClaimEligible=true},
    after=>{after.products[0].captures[0].offerPriceCents=50},
  ]
  for(const mutate of scenarios){
    const after=structuredClone(before)
    mutate(after)
    assert.throws(()=>comparePrivateRetailerCatalogs(before,after),/refused/)
  }
})

test('private mode-0600 real saved files feed executable count-only CLI',()=>isolated(async folder=>{
  const first=await original()
  const second=structuredClone(first)
  nextCapture(second)
  const a=join(folder,'before.json')
  const b=join(folder,'after.json')
  await writePrivateRetailerCatalog(first,a)
  await writePrivateRetailerCatalog(second,b)
  const runResult=run('--before',a,'--after',b)
  assert.equal(runResult.status,0,runResult.stderr)
  const report=JSON.parse(runResult.stdout)
  assert.equal(report.newCaptureEvents,1)
  assert.equal(report.publicSavingsClaimEligible,false)
  assert.doesNotMatch(runResult.stdout,/(?:www\.|capturedAt|sourceUrl|currentPriceCents|offerPriceCents|productName)/)
}))

test('the CLI refuses world-readable sources, aliases, and forged private metadata without stdout',()=>isolated(async folder=>{
  const first=await original()
  const a=join(folder,'before.json')
  const b=join(folder,'after.json')
  await writePrivateRetailerCatalog(first,a)
  await writePrivateRetailerCatalog(first,b)
  await chmod(a,0o644)
  let r=run('--before',a,'--after',b)
  assert.notEqual(r.status,0)
  assert.equal(r.stdout,'')
  assert.match(r.stderr,/refused/)
  await chmod(a,0o600)
  const alias=join(folder,'alias.json')
  await symlink(a,alias)
  r=run('--before',alias,'--after',b)
  assert.notEqual(r.status,0)
  assert.equal(r.stdout,'')
  const tainted=structuredClone(first)
  tainted.productionEnabled=true
  await writeFile(a,JSON.stringify(tainted),{mode:0o600})
  r=run('--before',a,'--after',b)
  assert.notEqual(r.status,0)
  assert.equal(r.stdout,'')
  assert.doesNotMatch(r.stderr,/\/tmp\/|before\.json|after\.json/)
}))
