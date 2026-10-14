import assert from 'node:assert/strict'
import test from 'node:test'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Only invented in-memory fixtures. No retailer/participant HTTP or prices.
const SHA='a'.repeat(64), SHAPE='b'.repeat(64)
const ERROR=/^Error: Invalid offline capture comparison report$/
function verified(id='fictional') {
  return {id,supermarket:'fictional-market',kind:'product',
    captureStatus:'verified',snapshotSha256:SHA,shapeSha256:SHAPE,
    schemaOrgStatus:'abstain',hasNextData:false,jsonLdCount:0,jsonLdParseErrors:0}
}
function unavailable(id='fictional') {
  return {id,supermarket:'fictional-market',kind:'product',
    captureStatus:'unavailable',snapshotSha256:null,shapeSha256:null,
    schemaOrgStatus:'unknown'}
}
function input(changes,baselineProvided=false) {
  return {contractVersion:1,mode:'offline_capture_signature_review_only',
    productionReady:false,m5Eligible:false,reviewerActionRequired:true,
    baselineProvided,captureCount:changes.filter(x=>x.current!==null).length,
    driftCount:changes.filter(x=>['removed','added','unavailable','shape_changed','origin_changed'].includes(x.status)).length,
    changes}
}
const row=(status,current,baseline=null)=>({id:(current??baseline).id,status,current,baseline})
function denyr(inputReport) {
  assert.throws(()=>buildOfflineSelectorReviewQueue(inputReport),ERROR)
}
test('direct queue refuses root mode getter without invoking it',()=>{
  const r=input([row('baseline_missing',verified('fake'))])
  let called=0
  Object.defineProperty(r,'mode',{get(){called++;throw Error('SECRET')}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root productionReady getter even if false',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'productionReady',{get(){called++;return false}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root m5Eligible getter',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'m5Eligible',{get(){called++;throw Error('PRIVATE')}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root reviewerActionRequired getter',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'reviewerActionRequired',{get(){called++;return true}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root captureCount getter without evaluating count',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'captureCount',{get(){called++;return 1}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root driftCount getter without evaluating count',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'driftCount',{get(){called++;return 0}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root changes getter without evaluating array',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'changes',{get(){called++;throw Error('PRIVATE')}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root baselineProvided getter',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'baselineProvided',{get(){called++;return false}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses root contractVersion getter',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.defineProperty(r,'contractVersion',{get(){called++;return 1}})
  denyr(r)
  assert.equal(called,0)
})
test('direct queue refuses missing root own field',()=>{
  const r=input([row('baseline_missing',verified())])
  delete r.mode
  denyr(r)
})
test('direct queue refuses inherited root getter without invoking it',()=>{
  const r=input([row('baseline_missing',verified())])
  let called=0
  Object.setPrototypeOf(r,Object.defineProperty({},'mode',{get(){called++;throw Error('PRIVATE')}}))
  delete r.mode
  denyr(r)
  assert.equal(called,0)
})
test('direct queue keeps legitimate immutable root counts/flags and anonymizes source token',()=>{
  const r=input([row('baseline_missing',verified('private-research-token'))])
  const old=structuredClone(r)
  const q=buildOfflineSelectorReviewQueue(r)
  assert.deepEqual(r,old)
  assert.equal(q.actions[0].priority,'P2')
  assert.equal(q.rightsVerified,false)
  assert.equal(q.selectorVerified,false)
  assert.equal(q.productionReady,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/private-research-token|fictional-market/)
})
test('direct queue keeps P1 unavailable and P3 historical unchanged with plain own envelope',()=>{
  const q1=buildOfflineSelectorReviewQueue(input([
    row('unavailable',unavailable('no-source'))]))
  assert.equal(q1.actions[0].priority,'P1')
  const s=verified('history-source')
  const q3=buildOfflineSelectorReviewQueue(input([
    row('unchanged',s,structuredClone(s))],true))
  assert.equal(q3.actions[0].priority,'P3')
  assert.equal(q1.m5Eligible,false)
  assert.equal(q3.rightsVerified,false)
})
test('direct queue actual fictitious captureShape→compareInspections envelope stays accepted',()=>{
  const cap={id:'fake-canonical-source',supermarket:'plus',kind:'product',
    success:true,integrity:'verified',manifestSha256:SHA,
    html:{hasNextData:false,applicationJsonScripts:[],
      jsonLd:[{type:['Product'],keys:['@type','name']}]},
    schemaOrgProduct:{type:'observation',observation:{name:'PRIVATE-FAKE-PRODUCT'}}}
  assert.equal(captureShape(cap).schemaOrgStatus,'candidate_observation')
  const report=compareInspections({sourceCount:1,sources:[cap]},
    {sourceCount:1,sources:[structuredClone(cap)]})
  const q=buildOfflineSelectorReviewQueue(report)
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.productionReady,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE-FAKE-PRODUCT|fake-canonical-source/)
})
