import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CORE_MARKET_BANNERS,
  assessCoreRetailerCoverage,
  compareCoreRetailerInventories,
} from '../scripts/m5-check-core-retailer-coverage.mjs'

// Independent QA on a frozen product source. The only input is the owner's
// research-only JSON inventory; no retailer/network/price/participant access.
const fixture = JSON.parse(await readFile(
  new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
const clone = () => structuredClone(fixture)
const script = new URL('../scripts/m5-check-core-retailer-coverage.mjs', import.meta.url)
function run(args = []) {
  return spawnSync(process.execPath, [script.pathname, ...args], {
    encoding: 'utf8', timeout: 20_000,
  })
}
function alwaysUnapproved(report) {
  for (const key of ['rightsVerified', 'productionReady', 'm5Eligible']) {
    assert.equal(report[key], false, key + ' must remain false')
  }
}
const remove = (doc, ids) => {
  const omitted = new Set(ids)
  doc.sources = doc.sources.filter(source => !omitted.has(source.id))
  return doc
}
for (const banner of CORE_MARKET_BANNERS) {
  test('QA: required banner '+banner+' cannot be silently omitted', () => {
    const input = remove(clone(), [banner])
    const snapshot = structuredClone(input)
    const report = assessCoreRetailerCoverage(input)
    assert.equal(report.coreCovered, false)
    assert.equal(report.requiredCount, 13)
    assert.equal(report.coveredRequiredCount, 12)
    assert.equal(report.candidateCount, 16)
    assert.deepEqual(report.missingRequiredIds, [banner])
    alwaysUnapproved(report)
    assert.deepEqual(input, snapshot, 'read-only inventory audit')
  })
}
test('QA: complete named checklist is only research coverage, not licensing', () => {
  const r = assessCoreRetailerCoverage(clone())
  assert.deepEqual(r.missingRequiredIds, [])
  assert.equal(r.coreCovered, true)
  assert.equal(r.requiredCount, 13)
  assert.equal(r.coveredRequiredCount, 13)
  assert.equal(r.candidateCount, 17)
  assert.match(r.purpose, /offline_candidate_inventory_completeness_only/)
  assert.match(r.milestone, /M3 active/)
  alwaysUnapproved(r)
})
test('QA: removing all core banners does not allow four extras to substitute', () => {
  const d = remove(clone(), CORE_MARKET_BANNERS)
  const r = assessCoreRetailerCoverage(d)
  assert.equal(r.coreCovered, false)
  assert.equal(r.coveredRequiredCount, 0)
  assert.deepEqual(r.missingRequiredIds, CORE_MARKET_BANNERS)
  assert.equal(r.candidateCount, 4)
  alwaysUnapproved(r)
})
test('QA: adding many decoy banners cannot replace omitted required chain', () => {
  const d=remove(clone(), ['plus'])
  const base=d.sources[0]
  for(let i=0;i<15;i++)d.sources.push({...base,id:'fictional-extra-'+i,name:'Research only '+i})
  const r=assessCoreRetailerCoverage(d)
  assert.equal(r.candidateCount,31)
  assert.deepEqual(r.missingRequiredIds,['plus'])
  assert.equal(r.coreCovered,false)
  alwaysUnapproved(r)
})
test('QA: losing PLUS and DekaMarkt has explicit ordered missing IDs', () => {
  const r=assessCoreRetailerCoverage(remove(clone(),['plus','dekamarkt']))
  assert.deepEqual(r.missingRequiredIds,['dekamarkt','plus'])
  assert.equal(r.coveredRequiredCount,11)
  alwaysUnapproved(r)
})
test('QA: deleting only a noncore candidate keeps core coverage but is reviewable drift', () => {
  const old=clone(), latest=remove(clone(),['odin'])
  const r=compareCoreRetailerInventories(latest,old)
  assert.equal(r.coreCovered,true)
  assert.deepEqual(r.removedCandidateIds,['odin'])
  assert.equal(r.changed,true)
  assert.equal(r.humanReviewRequired,true)
  assert.equal(r.historicalEvidenceVerified,false)
  alwaysUnapproved(r)
})
test('QA: adding a previously missing core banner cannot grant rights', () => {
  const earlier=remove(clone(),['boni'])
  const r=compareCoreRetailerInventories(clone(),earlier)
  assert.deepEqual(r.addedCandidateIds,['boni'])
  assert.deepEqual(r.removedCandidateIds,[])
  assert.equal(r.humanReviewRequired,true)
  assert.equal(r.historicalEvidenceVerified,false)
  alwaysUnapproved(r)
})
test('QA: two equal independent research-only inventories do not prove observation history', () => {
  const current=clone(), historical=clone()
  const before=structuredClone(current), prior=structuredClone(historical)
  const r=compareCoreRetailerInventories(current,historical)
  assert.equal(r.changed,false)
  assert.equal(r.humanReviewRequired,false)
  assert.equal(r.historicalEvidenceVerified,false)
  alwaysUnapproved(r)
  assert.deepEqual(current,before)
  assert.deepEqual(historical,prior)
})
test('QA: identical owner object cannot masquerade as a distinct historical inventory',()=>{
  const d=clone()
  assert.throws(()=>compareCoreRetailerInventories(d,d), /Distinct inventory inputs required/)
})
test('QA: separate wrappers sharing exact source list are never independent history',()=>{
  const d=clone()
  const old={...d}
  assert.throws(()=>compareCoreRetailerInventories(d,old),/Distinct inventory inputs required/)
})
test('QA: forged production claim in root is always refused by owner schema',()=>{
  const d=clone();d.productionReady=true
  assert.throws(()=>assessCoreRetailerCoverage(d),/schema fields/)
})
test('QA: unauthorized permission upgrade cannot become approved research inventory',()=>{
  const d=clone();d.sources[0].permissionStatus='approved'
  assert.throws(()=>assessCoreRetailerCoverage(d),/Unverified permission status/)
})
test('QA: guessed source mechanism cannot turn coverage into ingest',()=>{
  const d=clone();d.sources[0].sourceMechanism='official-api'
  assert.throws(()=>assessCoreRetailerCoverage(d),/Source mechanism cannot be assumed/)
})
test('QA: production enabled field is never accepted in research record',()=>{
  const d=clone();d.sources[0].productionEnabled=true
  assert.throws(()=>assessCoreRetailerCoverage(d),/cannot enable production/)
})
test('QA: fabricated written permission evidence cannot pass without owner gate',()=>{
  const d=clone();d.sources[0].permissionEvidence='fake-consent'
  assert.throws(()=>assessCoreRetailerCoverage(d),/cannot claim reviewed permissionEvidence/)
})
test('QA: mutated license evidence research URL cannot be silently used',()=>{
  const d=clone();d.sources[0].researchUrl='https://invalid.example/private'
  assert.throws(()=>assessCoreRetailerCoverage(d),/Missing HTTPS market-list evidence/)
})
test('QA: reordering source records cannot alter complete coverage',()=>{
  const d=clone();d.sources.reverse()
  const unmodified=structuredClone(d)
  const r=assessCoreRetailerCoverage(d)
  assert.equal(r.coreCovered,true)
  assert.equal(r.candidateCount,17)
  alwaysUnapproved(r)
  assert.deepEqual(d,unmodified)
})
test('QA CLI: original unmodified 17-candidate register exits 0 with all release flags false',()=>{
  const p=run()
  assert.equal(p.status,0,p.stderr)
  assert.equal(p.stderr,'')
  const r=JSON.parse(p.stdout)
  assert.equal(r.coreCovered,true)
  assert.equal(r.candidateCount,17)
  alwaysUnapproved(r)
})
test('QA CLI: a missing DekaMarkt keeps exit 2 without user/price data',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-coverage-'))
  try{
    const file=join(dir,'current.json')
    await writeFile(file,JSON.stringify(remove(clone(),['dekamarkt'])),{mode:0o600})
    const p=run([file])
    assert.equal(p.status,2,p.stderr)
    assert.equal(p.stderr,'')
    const r=JSON.parse(p.stdout)
    assert.deepEqual(r.missingRequiredIds,['dekamarkt'])
    assert.equal(r.coreCovered,false)
    alwaysUnapproved(r)
  }finally{await rm(dir,{recursive:true,force:true})}
})
test('QA CLI: private invalid JSON path and payload never leak in errors',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'supa-qa-private-'))
  try{
    const file=join(dir,'PRIVATE-SENSITIVE-NEVER-ECHO.json')
    await writeFile(file,'{"private":"NEVER-ECHO-THIS"}',{mode:0o600})
    const p=run([file])
    assert.equal(p.status,2)
    assert.equal(p.stdout,'')
    assert.equal(p.stderr,'Invalid offline retailer coverage input\n')
  }finally{await rm(dir,{recursive:true,force:true})}
})
test('QA CLI: unknown production switch never enables permissions',()=>{
  const p=run(['--enable-production'])
  assert.equal(p.status,2)
  assert.equal(p.stdout,'')
  assert.equal(p.stderr,'Invalid offline retailer coverage input\n')
})
