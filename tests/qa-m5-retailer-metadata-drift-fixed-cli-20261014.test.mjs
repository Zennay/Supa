import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  compareCoreRetailerInventories,
  assessCoreRetailerCoverage,
} from '../scripts/m5-check-core-retailer-coverage.mjs'

// Independent QA source-owner verification. Fictional edits to the existing
// research-only document. No HTTPS, supermarket data, shopper or price I/O.
const base = JSON.parse(await readFile(
  new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
const copy = () => structuredClone(base)
const evidence = 'https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten'
const script = new URL('../scripts/m5-check-core-retailer-coverage.mjs', import.meta.url)
const candidate = (doc, id) => {
  const row = doc.sources.find(source => source.id === id)
  assert.ok(row)
  return row
}
function safe(result) {
  assert.equal(result.rightsVerified, false)
  assert.equal(result.productionReady, false)
  assert.equal(result.m5Eligible, false)
  assert.equal(result.historicalEvidenceVerified, false)
  assert.equal(result.purpose, 'offline_market_inventory_change_review_only')
  assert.deepEqual(result.addedCandidateIds, [])
  assert.deepEqual(result.removedCandidateIds, [])
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-QA-PRICE-NEVER-OUTPUT/)
}
async function CLI(current, previous) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-market-drift-'))
  try {
    const nowPath = join(dir, 'PRIVATE-QA-PRICE-NEVER-OUTPUT-current.json')
    const oldPath = join(dir, 'PRIVATE-QA-PRICE-NEVER-OUTPUT-old.json')
    await writeFile(nowPath, JSON.stringify(current), { mode: 0o600 })
    await writeFile(oldPath, JSON.stringify(previous), { mode: 0o600 })
    return spawnSync(process.execPath, [script.pathname, nowPath, '--baseline', oldPath],
      { encoding: 'utf8', timeout: 20_000 })
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}
test('QA fixed-source: changed PLUS label is sorted canonical changed ID only', () => {
  const now=copy()
  candidate(now,'plus').name='Fictional changed PLUS label'
  const r=compareCoreRetailerInventories(now,copy())
  safe(r)
  assert.deepEqual(r.changedCandidateIds,['plus'])
  assert.equal(r.humanReviewRequired,true)
  assert.equal(r.changed,true)
  assert.doesNotMatch(JSON.stringify(r), /Fictional changed PLUS label/)
})
test('QA fixed-source: a changed public research citation is not source permission', () => {
  const now=copy()
  candidate(now,'dekamarkt').researchUrl=evidence
  const r=compareCoreRetailerInventories(now,copy())
  safe(r)
  assert.deepEqual(r.changedCandidateIds,['dekamarkt'])
  assert.equal(r.humanReviewRequired,true)
  assert.doesNotMatch(JSON.stringify(r), /consumentenbond/)
})
test('QA fixed-source: two changed candidates are sorted independently of source array order', () => {
  const now=copy()
  candidate(now,'plus').name='Fictional Plus label'
  candidate(now,'dekamarkt').researchUrl=evidence
  now.sources.reverse()
  const r=compareCoreRetailerInventories(now,copy())
  safe(r)
  assert.deepEqual(r.changedCandidateIds,['dekamarkt','plus'])
  assert.equal(r.humanReviewRequired,true)
})
test('QA fixed-source: a changed screening date receives manual review but is not field proof', () => {
  const now=copy()
  now.screenedAt='2026-10-12'
  const r=compareCoreRetailerInventories(now,copy())
  safe(r)
  assert.equal(r.screeningDateChanged,true)
  assert.deepEqual(r.changedCandidateIds,[])
  assert.equal(r.changed,true)
  assert.equal(r.humanReviewRequired,true)
})
test('QA fixed-source: unchanged separate snapshot remains no drift and no approval', () => {
  const r=compareCoreRetailerInventories(copy(),copy())
  safe(r)
  assert.deepEqual(r.changedCandidateIds,[])
  assert.equal(r.screeningDateChanged,false)
  assert.equal(r.changed,false)
  assert.equal(r.humanReviewRequired,false)
})
test('QA fixed-source: brand row order alone is never a changed candidate', () => {
  const now=copy()
  now.sources.reverse()
  const r=compareCoreRetailerInventories(now,copy())
  safe(r)
  assert.deepEqual(r.changedCandidateIds,[])
  assert.equal(r.humanReviewRequired,false)
})
test('QA fixed-source: labels may be changed while original input remains unchanged', () => {
  const now=copy()
  candidate(now,'odin').name='Fictional Odin label'
  const old=copy()
  const original=structuredClone(now)
  const past=structuredClone(old)
  const r=compareCoreRetailerInventories(now,old)
  safe(r)
  assert.deepEqual(r.changedCandidateIds,['odin'])
  assert.deepEqual(now,original)
  assert.deepEqual(old,past)
})
test('QA CLI: same research-only inventory exits zero and never claims rights', async () => {
  const run=await CLI(copy(),copy())
  assert.equal(run.status,0,run.stderr)
  assert.equal(run.stderr,'')
  const r=JSON.parse(run.stdout)
  safe(r)
  assert.equal(r.changed,false)
})
test('QA CLI: changed PLUS label exits two with ID-only privacy-safe report',async()=>{
  const now=copy()
  candidate(now,'plus').name='PRIVATE-QA-PRICE-NEVER-OUTPUT'
  const run=await CLI(now,copy())
  assert.equal(run.status,2,run.stderr)
  assert.equal(run.stderr,'')
  const r=JSON.parse(run.stdout)
  safe(r)
  assert.deepEqual(r.changedCandidateIds,['plus'])
  assert.equal(r.humanReviewRequired,true)
  assert.doesNotMatch(run.stdout,/PRIVATE-QA-PRICE-NEVER-OUTPUT/)
})
test('QA CLI: citation replacement exits two, never grants source rights',async()=>{
  const now=copy()
  candidate(now,'plus').researchUrl=evidence
  const run=await CLI(now,copy())
  assert.equal(run.status,2,run.stderr)
  assert.equal(run.stderr,'')
  const r=JSON.parse(run.stdout)
  safe(r)
  assert.deepEqual(r.changedCandidateIds,['plus'])
})
test('QA CLI: screening-date change exits two without inventing retailer observations',async()=>{
  const now=copy()
  now.screenedAt='2026-10-12'
  const run=await CLI(now,copy())
  assert.equal(run.status,2,run.stderr)
  assert.equal(run.stderr,'')
  const r=JSON.parse(run.stdout)
  safe(r)
  assert.equal(r.screeningDateChanged,true)
  assert.equal(r.historicalEvidenceVerified,false)
})
test('QA fixed-source: owner-auditor never upgrades invented rights fields during metadata drift',()=>{
  const now=copy()
  candidate(now,'plus').name='Fictional label only'
  const report=assessCoreRetailerCoverage(now)
  assert.equal(report.coreCovered,true)
  assert.equal(report.rightsVerified,false)
  assert.equal(report.productionReady,false)
  assert.equal(report.m5Eligible,false)
})
