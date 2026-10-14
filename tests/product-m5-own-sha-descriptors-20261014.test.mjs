import assert from 'node:assert/strict'
import test from 'node:test'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Invented in-memory inputs only: no retailer HTTP or identifiable data.
const A='a'.repeat(64)
const B='b'.repeat(64)
const ERROR=/^Error: Invalid offline capture comparison report$/
function verified(id='fake') {
  return {
    id, supermarket:'fictional-market', kind:'product', captureStatus:'verified',
    snapshotSha256:A, shapeSha256:B, schemaOrgStatus:'abstain',
    hasNextData:false, jsonLdCount:0, jsonLdParseErrors:0,
  }
}
const unavailable=(id='fake')=>({
  id,supermarket:'fictional-market',kind:'product',captureStatus:'unavailable',
  snapshotSha256:null,shapeSha256:null,schemaOrgStatus:'unknown',
})
const statuses=new Set(['unavailable','removed','added','shape_changed','origin_changed'])
const row=(status,current,baseline=null)=>({
  id:(current??baseline).id,status,current,baseline,
})
function report(changes,hasBaseline=false){
  return {contractVersion:1,mode:'offline_capture_signature_review_only',
    productionReady:false,m5Eligible:false,reviewerActionRequired:true,
    baselineProvided:hasBaseline,
    captureCount:changes.filter(x=>x.current!==null).length,
    driftCount:changes.filter(x=>statuses.has(x.status)).length,
    changes,
  }
}
const deny=(r)=>assert.throws(()=>buildOfflineSelectorReviewQueue(r),ERROR)
function getterProbe(field, side, status='unchanged') {
  let invoked=0
  const own=verified('fictional-getter')
  const past=verified('fictional-getter')
  const target=side==='baseline'?past:own
  const secret='fake-secret-private-price'
  Object.defineProperty(target,field,{
    enumerable:true,configurable:true,
    get(){invoked++;throw new Error(secret)},
  })
  const expected=Object.getOwnPropertyDescriptor(target,field)
  const input=report([row(status,own,past)],true)
  deny(input)
  assert.equal(invoked,0)
  assert.equal(Object.getOwnPropertyDescriptor(target,field).get,expected.get)
}
test('M5 rejects own snapshot SHA getter on verified current without invoking it',()=>{
  getterProbe('snapshotSha256','current')
})
test('M5 rejects own fingerprint getter on verified current without invoking it',()=>{
  getterProbe('shapeSha256','current')
})
test('M5 rejects own snapshot SHA getter on historical verified without invoking it',()=>{
  getterProbe('snapshotSha256','baseline')
})
test('M5 rejects own shape getter on historical verified without invoking it',()=>{
  getterProbe('shapeSha256','baseline')
})
test('M5 refuses inherited snapshot hash accessor without invocation',()=>{
  let calls=0
  const source=verified()
  const proto=Object.defineProperty({},'snapshotSha256',{
    get(){calls++;throw Error('private')},
  })
  Object.setPrototypeOf(source,proto)
  delete source.snapshotSha256
  deny(report([row('baseline_missing',source)]))
  assert.equal(calls,0)
})
test('M5 refuses inherited shape accessor on removed historical source',()=>{
  let calls=0
  const old=verified('old-inherited')
  const proto=Object.defineProperty({},'shapeSha256',{
    get(){calls++;throw Error('private')},
  })
  Object.setPrototypeOf(old,proto)
  delete old.shapeSha256
  deny(report([row('removed',null,old)],true))
  assert.equal(calls,0)
})
test('M5 refuses missing own snapshot hash even when no prototype getter exists',()=>{
  const old=verified('p1-history')
  delete old.snapshotSha256
  deny(report([row('removed',null,old)],true))
})
test('M5 refuses missing own shape hash on positive P2 first capture',()=>{
  const now=verified('p2-first')
  delete now.shapeSha256
  deny(report([row('baseline_missing',now)]))
})
test('M5 accessor carrying valid-looking SHA cannot be laundered into P3',()=>{
  let calls=0
  const now=verified()
  Object.defineProperty(now,'snapshotSha256',{get(){calls++;return A}})
  deny(report([row('unchanged',now,verified())],true))
  assert.equal(calls,0)
})
test('M5 accessor returning primitive from baseline shape cannot launder P1',()=>{
  let calls=0
  const baseline=verified('changed')
  Object.defineProperty(baseline,'shapeSha256',{get(){calls++;return B}})
  deny(report([row('shape_changed',verified('changed'),baseline)],true))
  assert.equal(calls,0)
})
test('M5 true own primitive SHA hashes preserve no-baseline P2 and release denial',()=>{
  const result=buildOfflineSelectorReviewQueue(
    report([row('baseline_missing',verified('good-p2'))]))
  assert.equal(result.actions[0].priority,'P2')
  assert.equal(result.rightsVerified,false)
  assert.equal(result.selectorVerified,false)
  assert.equal(result.productionReady,false)
  assert.equal(result.m5Eligible,false)
})
test('M5 P1 unavailable remains valid with null digests',()=>{
  const result=buildOfflineSelectorReviewQueue(
    report([row('unavailable',unavailable('good-failure'))]))
  assert.equal(result.actions[0].priority,'P1')
  assert.equal(result.productionReady,false)
})
test('M5 historical P1 removed with ordinary own data hashes stays human-only',()=>{
  const result=buildOfflineSelectorReviewQueue(
    report([row('removed',null,verified('removed-id'))],true))
  assert.equal(result.actions[0].priority,'P1')
  assert.equal(result.rightsVerified,false)
  assert.doesNotMatch(JSON.stringify(result),/removed-id|fictional-market/)
})
test('M5 ordinary frozen P3 current and baseline own hashes remain accepted',()=>{
  const s=verified('p3-fake')
  const result=buildOfflineSelectorReviewQueue(
    report([row('unchanged',s,structuredClone(s))],true))
  assert.equal(result.actions[0].priority,'P3')
  assert.equal(result.m5Eligible,false)
})
test('M5 M1 captureShape HTML to comparison to queue still emits own primitive hashes',()=>{
  const s={
    id:'fake-canonical',supermarket:'plus',kind:'product',success:true,
    integrity:'verified',manifestSha256:A,
    html:{hasNextData:false,applicationJsonScripts:[],jsonLd:[
      {type:['Product'],keys:['@type','name']},
    ]},
    schemaOrgProduct:{type:'observation',observation:{name:'private-test'}},
  }
  const canonical=captureShape(s)
  for(const field of ['snapshotSha256','shapeSha256']) {
    const descriptor=Object.getOwnPropertyDescriptor(canonical,field)
    assert.equal(typeof descriptor.value,'string')
  }
  const q=buildOfflineSelectorReviewQueue(compareInspections(
    {sourceCount:1,sources:[s]}, {sourceCount:1,sources:[structuredClone(s)]}))
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.productionReady,false)
  assert.equal(q.rightsVerified,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/fake-canonical|private-test/)
})
