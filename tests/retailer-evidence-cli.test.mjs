import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compareSavedRetailerEvidence, main } from '../scripts/retailer-compare-reviewed-evidence.mjs'

test('actual checked-in reviewed listing fixtures flow through full offline CLI integration',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-evidence-cli-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const req=join(dir,'requirements.json')
  await writeFile(req,JSON.stringify([{id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}]))
  const plus=new URL('../fixtures/m1/plus-rendered-catalog.v1.json',import.meta.url)
  const deka=new URL('../fixtures/m1/dekamarkt-catalog-melk.v1.json',import.meta.url)
  const comparison=await compareSavedRetailerEvidence(
    req,plus,deka,Date.parse('2026-10-04T19:00:00Z'))
  assert.equal(comparison.format,'supa-offline-store-catalog-v1')
  assert.equal(comparison.parsedProducts,7)
  assert.equal(comparison.claimable,false)
  assert.equal(comparison.comparison.lines.length,1)
  assert.equal(comparison.comparison.comparable,false)
  assert.equal(comparison.comparison.savingsCents,null)
  const stale=await compareSavedRetailerEvidence(
    req,plus,deka,Date.parse('2026-10-15T10:00:00Z'))
  assert.equal(stale.comparison.reason,'invalid_or_stale_source')
  await assert.rejects(main([req,plus,deka,'--wrong','whatever']),/Usage/)
})

test('nonexistent or invalid saved source cannot become a comparison',async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-evidence-failure-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const req=join(dir,'req.json'), plus=join(dir,'plus.json'), deka=join(dir,'deka.json')
  await writeFile(req,JSON.stringify([{id:'milk',query:'milk',amount:1000,unit:'ml'}]))
  await writeFile(plus,JSON.stringify({evidenceType:'not-reviewed'}))
  await writeFile(deka,'{}')
  await assert.rejects(compareSavedRetailerEvidence(req,plus,deka,Date.now()),/Untrusted/)
  await assert.rejects(compareSavedRetailerEvidence(req,plus,join(dir,'missing'),Date.now()))
})
