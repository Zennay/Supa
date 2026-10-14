import assert from 'node:assert/strict'
import test from 'node:test'

import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All metadata are synthetic. Never read real retailer/customer information.
const invalid = /^Error: Invalid offline capture comparison report$/
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const verified = (id, schemaOrgStatus='candidate_observation', count=1, errors=0) => ({
  id, supermarket:'sample_store', kind:'product', captureStatus:'verified',
  snapshotSha256:SHA_A, shapeSha256:SHA_A, schemaOrgStatus,
  hasNextData:false, jsonLdCount:count, jsonLdParseErrors:errors,
})
const unavailable = (id) => ({
  id, supermarket:'sample_store', kind:'product', captureStatus:'unavailable',
  snapshotSha256:null, shapeSha256:null, schemaOrgStatus:'unknown',
})
const row = (status, current, baseline=null) => ({
  id:(current ?? baseline).id, status, current, baseline,
})
const drift = new Set(['unavailable','origin_changed','removed','added','shape_changed'])
function report(changes, baselineProvided=false) {
  return {
    contractVersion:1, mode:'offline_capture_signature_review_only',
    productionReady:false, m5Eligible:false, reviewerActionRequired:true,
    baselineProvided, captureCount:changes.filter((c)=>c.current!==null).length,
    driftCount:changes.filter((c)=>drift.has(c.status)).length, changes,
  }
}
function deny(input) {
  const cloned=structuredClone(input)
  assert.throws(()=>buildOfflineSelectorReviewQueue(input),invalid)
  assert.deepEqual(input,cloned)
}
const queue = (input) => buildOfflineSelectorReviewQueue(input)

test('direct queue rejects candidate with zero HTML JSON-LD records in P2 first capture',()=>{
  deny(report([row('baseline_missing',verified('private-no-jsonld','candidate_observation',0,0))]))
})
test('direct queue rejects candidate with two parse errors out of two JSON-LD records',()=>{
  deny(report([row('baseline_missing',verified('private-all-parse-errors','candidate_observation',2,2))]))
})
test('direct queue rejects candidate with 128/128 parser failures',()=>{
  deny(report([row('baseline_missing',verified('fictional-128','candidate_observation',128,128))]))
})
test('direct queue rejects newly added P2 candidate with zero successful parsed entries',()=>{
  deny(report([row('added',verified('fictional-added','candidate_observation',1,1))],true))
})
test('direct queue rejects false current candidate in P3 identical baseline',()=>{
  const bad=verified('fictional-stable','candidate_observation',0,0)
  deny(report([row('unchanged',bad,structuredClone(bad))],true))
})
test('direct queue rejects false historical candidate even if current P3 is valid',()=>{
  const current=verified('fictional-previous','candidate_observation',3,2)
  const past=structuredClone(current)
  past.jsonLdCount=2
  past.jsonLdParseErrors=2
  deny(report([row('unchanged',current,past)],true))
})
test('direct queue rejects false current P1 shape-drift observation',()=>{
  const current=verified('fictional-shape','candidate_observation',1,1)
  const baseline=verified('fictional-shape','abstain',0,0)
  baseline.shapeSha256=SHA_B
  deny(report([row('shape_changed',current,baseline)],true))
})
test('direct queue rejects false historical candidate on P1 unavailable recapture',()=>{
  const current=unavailable('fictional-failure')
  const baseline=verified('fictional-failure','candidate_observation',0,0)
  deny(report([row('unavailable',current,baseline)],true))
})
test('direct queue rejects forged positive previous snapshot in P1 origin change',()=>{
  const current=verified('fictional-drift','abstain',0,0)
  current.supermarket='new_store'
  const baseline=verified('fictional-drift','candidate_observation',1,1)
  deny(report([row('origin_changed',current,baseline)],true))
})
test('direct queue allows an abstain with zero JSON-LD blocks, but never approves selectors',()=>{
  const result=queue(report([row('baseline_missing',verified('fictional-abstain','abstain',0,0))]))
  assert.equal(result.actions[0].priority,'P2')
  assert.equal(result.selectorVerified,false)
  assert.equal(result.rightsVerified,false)
  assert.equal(result.productionReady,false)
  assert.equal(result.m5Eligible,false)
})
test('direct queue allows an abstain even when all JSON-LD scripts were malformed',()=>{
  const result=queue(report([row('baseline_missing',verified('fictional-error','abstain',3,3))]))
  assert.equal(result.actions[0].priority,'P2')
  assert.equal(result.m5Eligible,false)
})
test('direct queue allows candidate with precisely one successfully parsed JSON-LD record',()=>{
  const result=queue(report([row('baseline_missing',verified('fictional-good','candidate_observation',2,1))]))
  assert.equal(result.actions[0].priority,'P2')
  assert.equal(result.summary.actionCount,1)
  assert.equal(result.productionReady,false)
})
test('direct queue validates both historical/current candidate snapshots in true P3',()=>{
  const sample=verified('fictional-p3','candidate_observation',1,0)
  const result=queue(report([row('unchanged',sample,structuredClone(sample))],true))
  assert.equal(result.actions[0].priority,'P3')
  assert.equal(result.actions[0].status,'unchanged')
  assert.equal(result.m5Eligible,false)
})
test('direct queue still accepts failed first capture as P1',()=>{
  const result=queue(report([row('unavailable',unavailable('fictional-failure'))]))
  assert.equal(result.actions[0].priority,'P1')
  assert.equal(result.actions[0].selectorVerified,false)
})
test('canonical captureShape positive descriptor can reach human-only queue unchanged',()=>{
  const source={
    id:'fictional-canonical', supermarket:'plus', kind:'product',
    success:true, integrity:'verified', manifestSha256:SHA_A,
    html:{hasNextData:false,
      jsonLd:[{type:['Product'],keys:['@type','name']}],
      applicationJsonScripts:[]},
    schemaOrgProduct:{type:'observation', observation:{name:'private-fictional'}},
  }
  const parsed=captureShape(source)
  assert.equal(parsed.jsonLdCount,1)
  assert.equal(parsed.jsonLdParseErrors,0)
  const comparison=compareInspections({sourceCount:1,sources:[source]},
    {sourceCount:1,sources:[structuredClone(source)]})
  const result=queue(comparison)
  assert.equal(result.actions[0].priority,'P3')
  assert.equal(result.rightsVerified,false)
  assert.equal(result.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(result),/fictional-canonical|private-fictional/)
})
test('generic rejection never echoes private source identifiers',()=>{
  const source=verified('private-do-not-echo','candidate_observation',0,0)
  try {
    queue(report([row('baseline_missing',source)]))
    assert.fail('Expected invalid parser evidence')
  } catch(error) {
    assert.match(String(error),invalid)
    assert.doesNotMatch(String(error),/private-do-not-echo/)
  }
})
