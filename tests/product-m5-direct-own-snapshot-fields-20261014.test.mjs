import assert from 'node:assert/strict'
import test from 'node:test'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Memory-only fictional inputs. No real retailer, price or participant data.
const A='a'.repeat(64), B='b'.repeat(64)
const ERROR=/^Error: Invalid offline capture comparison report$/
function verified(id='fake') {
  return {id, supermarket:'fictional-market',kind:'product',
    captureStatus:'verified',snapshotSha256:A,shapeSha256:B,
    schemaOrgStatus:'abstain',hasNextData:false,jsonLdCount:0,jsonLdParseErrors:0}
}
function unavailable(id='fake') {
  return {id,supermarket:'fictional-market',kind:'product',
    captureStatus:'unavailable',snapshotSha256:null,shapeSha256:null,
    schemaOrgStatus:'unknown'}
}
const row=(status,current,baseline=null)=>({
  id:(current??baseline).id,status,current,baseline,
})
const drift=new Set(['unavailable','removed','added','shape_changed','origin_changed'])
function report(changes,baselineProvided=false) {
  return {contractVersion:1,mode:'offline_capture_signature_review_only',
    productionReady:false,m5Eligible:false,reviewerActionRequired:true,
    baselineProvided,
    captureCount:changes.filter(x=>x.current!==null).length,
    driftCount:changes.filter(x=>drift.has(x.status)).length,
    changes}
}
const deny=(r)=>assert.throws(()=>buildOfflineSelectorReviewQueue(r),ERROR)
function accessorFailure(field,on='current',status='unchanged') {
  const cur=verified('cohort-one'),old=verified('cohort-one')
  const target=on==='baseline'?old:cur
  let called=0
  Object.defineProperty(target,field,{enumerable:true,configurable:true,
    get(){called++;throw Error('PRIVATE-NEVER-READ')}})
  const input=report([row(status,cur,old)],true)
  deny(input)
  assert.equal(called,0)
}
test('direct queue rejects current verified schemaOrgStatus getter before invoking',()=>{
  accessorFailure('schemaOrgStatus')
})
test('direct queue rejects historical current-state status getter',()=>{
  accessorFailure('captureStatus','baseline')
})
test('direct queue rejects current origin getter without running code',()=>{
  accessorFailure('supermarket')
})
test('direct queue rejects historical kind getter without running code',()=>{
  accessorFailure('kind','baseline')
})
test('direct queue rejects current JSON-LD count getter',()=>{
  accessorFailure('jsonLdCount')
})
test('direct queue rejects historical JSON-LD parse-errors getter',()=>{
  accessorFailure('jsonLdParseErrors','baseline')
})
test('direct queue rejects current hasNextData getter',()=>{
  accessorFailure('hasNextData')
})
test('direct queue rejects historical snapshot ID getter',()=>{
  accessorFailure('id','baseline')
})
test('direct queue rejects current own hash getter',()=>{
  accessorFailure('snapshotSha256')
})
test('direct queue rejects historical own shape hash getter',()=>{
  accessorFailure('shapeSha256','baseline')
})
test('direct queue rejects inherited required source kind without getting prototype getter',()=>{
  let called=0
  const s=verified('inherited')
  Object.setPrototypeOf(s,Object.defineProperty({},'kind',{get(){called++;throw Error('SECRET')}}))
  delete s.kind
  deny(report([row('baseline_missing',s)]))
  assert.equal(called,0)
})
test('direct queue rejects own accessor on change id before any queue action',()=>{
  const entry=row('baseline_missing',verified('change-id'))
  let called=0
  Object.defineProperty(entry,'id',{get(){called++;throw Error('PRIVATE-ID')}})
  deny(report([entry]))
  assert.equal(called,0)
})
test('direct queue rejects own accessor on change status before any queue action',()=>{
  const entry=row('baseline_missing',verified('change-status'))
  let called=0
  const input=report([entry])
  Object.defineProperty(entry,'status',{get(){called++;return 'baseline_missing'}})
  deny(input)
  assert.equal(called,0)
})
test('direct queue rejects own accessor on current or baseline cohort',()=>{
  for(const key of ['current','baseline']){
    const entry=row('unchanged',verified('value'),verified('value'))
    let called=0
    const input=report([entry],true)
    Object.defineProperty(entry,key,{get(){called++;throw Error('PRIVATE')}})
    deny(input)
    assert.equal(called,0)
  }
})
test('direct queue rejects accessor for entire declared changes slot',()=>{
  const changes=[row('baseline_missing',verified('slot'))]
  let called=0
  Object.defineProperty(changes,0,{get(){called++;throw Error('PRIVATE')}})
  deny({contractVersion:1,mode:'offline_capture_signature_review_only',
    productionReady:false,m5Eligible:false,reviewerActionRequired:true,
    baselineProvided:false,captureCount:1,driftCount:0,changes})
  assert.equal(called,0)
})
test('direct queue rejects sparse declared changes slot',()=>{
  const changes=Array(1)
  deny({contractVersion:1,mode:'offline_capture_signature_review_only',
    productionReady:false,m5Eligible:false,reviewerActionRequired:true,
    baselineProvided:false,captureCount:1,driftCount:0,changes})
})
test('direct queue rejects inherited inspected count and does not run inherited getter',()=>{
  const s=verified('inherited-count')
  let called=0
  Object.setPrototypeOf(s,Object.defineProperty({},'jsonLdCount',{
    get(){called++;throw Error('PRIVATE')}}))
  delete s.jsonLdCount
  deny(report([row('baseline_missing',s)]))
  assert.equal(called,0)
})
test('direct queue valid no-baseline P2, failed P1, verified historical P3 remain manual-only',()=>{
  const start=buildOfflineSelectorReviewQueue(report([
    row('baseline_missing',verified('ordinary')),row('unavailable',unavailable('offline'))]))
  assert.deepEqual(start.actions.map(x=>x.priority),['P1','P2'])
  const old=verified('secret-source-stable')
  const steady=buildOfflineSelectorReviewQueue(report(
    [row('unchanged',old,structuredClone(old))],true))
  assert.equal(steady.actions[0].priority,'P3')
  for(const result of [start,steady]){
    assert.equal(result.selectorVerified,false)
    assert.equal(result.rightsVerified,false)
    assert.equal(result.productionReady,false)
    assert.equal(result.m5Eligible,false)
    assert.doesNotMatch(JSON.stringify(result),/ordinary|good-failure|secret-source-stable|fictional-market/)
  }
})
test('direct queue valid Product M1→M5 pair keeps P3 and opaque labels',()=>{
  const capture={id:'never-release-id',supermarket:'plus',kind:'product',
    success:true,integrity:'verified',manifestSha256:A,
    html:{hasNextData:false,jsonLd:[{type:['Product'],keys:['@type','name']}],
      applicationJsonScripts:[]},
    schemaOrgProduct:{type:'observation',observation:{name:'PRIVATE-NAME'}}}
  assert.equal(captureShape(capture).schemaOrgStatus,'candidate_observation')
  const input=compareInspections({sourceCount:1,sources:[capture]},
    {sourceCount:1,sources:[structuredClone(capture)]})
  const before=structuredClone(input)
  const q=buildOfflineSelectorReviewQueue(input)
  assert.deepEqual(input,before)
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.rightsVerified,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/never-release-id|PRIVATE-NAME/)
})
test('direct queue provenance checks still reject false observation with zero successful JSON-LD',()=>{
  const now=verified('no-success')
  now.schemaOrgStatus='candidate_observation'
  deny(report([row('baseline_missing',now)]))
})
