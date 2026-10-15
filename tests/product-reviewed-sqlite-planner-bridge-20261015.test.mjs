import assert from 'node:assert/strict'
import { mkdtemp, rm, chmod, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { buildPersistedReviewedWeek, main } from '../scripts/retailer-private-sqlite-planner-review.mjs'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

const reader = new URL('../scripts/retailer-private-sqlite-planner-reader.py', import.meta.url).pathname

test('actual six-source SQLite pipeline recomputes selected M3 planner week without live money', async () => {
  const mondayThursday = await buildPersistedReviewedWeek(['--days','Ma,Do'])
  assert.equal(mondayThursday.mode,'persisted-private-sqlite-to-dynamic-planner-review')
  assert.equal(mondayThursday.sourceSnapshots,6)
  assert.ok(mondayThursday.persistedProducts >= 1)
  assert.equal(mondayThursday.selectedMealDays,2)
  assert.equal(mondayThursday.ingredientNeeds,5)
  assert.equal(mondayThursday.retailerReviewRows,10)
  assert.equal(mondayThursday.proposedForManualReview + mondayThursday.unresolved,10)
  assert.equal(mondayThursday.livePricesAvailable,false)
  assert.equal(mondayThursday.externalRequests,0)
  assert.equal(mondayThursday.productionEnabled,false)
  assert.equal(mondayThursday.publicSavingsClaimEligible,false)
  assert.doesNotMatch(JSON.stringify(mondayThursday), /https?:|productName|packAmount|priceCents|participantKey|sourceUrl/i)
  const all = await buildPersistedReviewedWeek()
  assert.equal(all.selectedMealDays,4)
  assert.equal(all.ingredientNeeds,11)
  assert.equal(all.retailerReviewRows,22)
})

test('actual CLI prints only safe counts and refuses unrecognized day arguments', async () => {
  const output=[]
  const result=await main(['--days','Di,Wo'],s=>output.push(s))
  assert.equal(output.length,1)
  assert.deepEqual(JSON.parse(output[0]),result)
  assert.equal(result.selectedMealDays,2)
  assert.equal(result.livePricesAvailable,false)
  assert.doesNotMatch(output[0], /sourceUrl|snapshotSha256|priceCents|@|https:|Kippendij|melk|token/i)
  for(const args of [['--days','Ma,Ma'],['--days','Vr'],['--days','../Ma'],['--out','private.db'],['--days']]) {
    await assert.rejects(buildPersistedReviewedWeek(args), /Only/)
  }
})

test('read-only SQLite reader rejects public-readable or symlinked catalog, preserving original bytes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'supa-sqlite-review-negative-'))
  const db=join(dir,'historical.db')
  const alias=join(dir,'alias.db')
  try {
    await buildReviewedRetailerSqlite(db)
    const initial=await stat(db)
    assert.equal(initial.mode & 0o777,0o600)
    const accepted=spawnSync('python3',[reader,'--database',db],{encoding:'utf8',timeout:20_000,maxBuffer:4*1024*1024})
    assert.equal(accepted.status,0,accepted.stderr)
    const privateCatalog=JSON.parse(accepted.stdout)
    assert.equal(privateCatalog.productCount>0,true)
    assert.equal(privateCatalog.publicSavingsClaimEligible,false)
    assert.equal(privateCatalog.productionEnabled,false)
    assert.ok(privateCatalog.products.every(p=>p.currentTrustedPriceCents===null && p.publishable===false))
    assert.doesNotMatch(accepted.stdout,/price_cents|currentPriceCents|sourceUrl|offerPriceCents/i)
    assert.equal((await stat(db)).size,initial.size)
    await symlink(db,alias)
    const linked=spawnSync('python3',[reader,'--database',alias],{encoding:'utf8',timeout:20_000})
    assert.notEqual(linked.status,0)
    assert.doesNotMatch(linked.stderr, /\/tmp\/|https?:|\.db\b/i)
    await chmod(db,0o644)
    const world=spawnSync('python3',[reader,'--database',db],{encoding:'utf8',timeout:20_000})
    assert.notEqual(world.status,0)
    assert.equal(world.stdout,'')
  } finally {
    await rm(dir,{recursive:true,force:true})
  }
})
