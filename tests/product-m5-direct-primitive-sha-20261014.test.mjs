import assert from 'node:assert/strict'
import test from 'node:test'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Entirely synthetic, memory-only future M5 manual review; no retailer HTTP.
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const ERROR = /^Error: Invalid offline capture comparison report$/
const verified = (id='fake') => ({
  id, supermarket:'fictional-store', kind:'product', captureStatus:'verified',
  snapshotSha256:A, shapeSha256:B, schemaOrgStatus:'abstain',
  hasNextData:false, jsonLdCount:0, jsonLdParseErrors:0,
})
const unavailable = (id='fake') => ({
  id, supermarket:'fictional-store', kind:'product', captureStatus:'unavailable',
  snapshotSha256:null, shapeSha256:null, schemaOrgStatus:'unknown',
})
const drift = new Set(['added','removed','unavailable','shape_changed','origin_changed'])
const row = (status,current,baseline=null) => ({
  id:(current ?? baseline).id, status, current, baseline,
})
function report(changes, baselineProvided=false) {
  return {
    contractVersion:1,mode:'offline_capture_signature_review_only',
    productionReady:false,m5Eligible:false,reviewerActionRequired:true,
    baselineProvided,
    captureCount:changes.filter(x=>x.current!==null).length,
    driftCount:changes.filter(x=>drift.has(x.status)).length,
    changes,
  }
}
function rejects(reportInput) {
  assert.throws(()=>buildOfflineSelectorReviewQueue(reportInput),ERROR)
}
function putBad(field,badValue,placement='current') {
  const a=verified('fictional')
  const b=verified('fictional')
  const chosen=placement==='current'?a:b
  chosen[field]=badValue
  return report([row('unchanged',a,b)],true)
}
test('M5 direct queue rejects boxed String as snapshot hash in current P3',()=>{
  rejects(putBad('snapshotSha256',new String(A)))
})
test('M5 direct queue rejects boxed String as fingerprint in baseline P3',()=>{
  rejects(putBad('shapeSha256',new String(B),'baseline'))
})
test('M5 direct queue rejects array of canonical hash as input text',()=>{
  rejects(putBad('snapshotSha256',[A]))
})
test('M5 direct queue rejects an array as historical shape hash',()=>{
  rejects(putBad('shapeSha256',[B],'baseline'))
})
test('M5 direct queue rejects null, undefined, booleans, numbers, and bigint hashes',()=>{
  for (const value of [null,undefined,false,true,0,64,0n,64n,Symbol('fake')]) {
    rejects(putBad('snapshotSha256',value))
    rejects(putBad('shapeSha256',value,'baseline'))
  }
})
test('M5 direct queue rejects custom hash coercion without calling it',()=>{
  let calls=0
  const obj={toString(){calls++; return A}}
  rejects(putBad('snapshotSha256',obj))
  assert.equal(calls,0)
})
test('M5 direct queue rejects custom fingerprint coercion without calling it',()=>{
  let calls=0
  const obj={[Symbol.toPrimitive](){calls++;return B}}
  rejects(putBad('shapeSha256',obj,'baseline'))
  assert.equal(calls,0)
})
test('M5 direct queue does not execute throwing toString or expose private text',()=>{
  let calls=0
  const privateLabel='private-product-name-should-not-leak'
  const obj={toString(){calls++;throw Error(privateLabel)}}
  try {
    rejects(putBad('snapshotSha256',obj))
  } catch (error) {
    assert.doesNotMatch(String(error),new RegExp(privateLabel))
    throw error
  }
  assert.equal(calls,0)
})
test('M5 direct queue does not execute throwing Symbol.toPrimitive',()=>{
  let calls=0
  const obj={[Symbol.toPrimitive](){calls++;throw Error('private-url')}}
  rejects(putBad('shapeSha256',obj,'baseline'))
  assert.equal(calls,0)
})
test('M5 P2 no-baseline candidate cannot use coercible snapshot digest',()=>{
  const s=verified('p2-fake')
  s.schemaOrgStatus='candidate_observation'
  s.jsonLdCount=1
  s.jsonLdParseErrors=0
  s.snapshotSha256=new String(A)
  rejects(report([row('baseline_missing',s)]))
})
test('M5 P1 historical removed cannot use coercible shape digest',()=>{
  const s=verified('p1-historical')
  let calls=0
  s.shapeSha256={[Symbol.toPrimitive](){calls++;return B}}
  rejects(report([row('removed',null,s)],true))
  assert.equal(calls,0)
})
test('M5 P1 unavailable with verified historical hash rejects coercion',()=>{
  const old=verified('p1-failed')
  old.snapshotSha256=[A]
  rejects(report([row('unavailable',unavailable('p1-failed'),old)],true))
})
test('M5 primitive lowercase 64-hex SHA in current P2 remains manual-only',()=>{
  const output=buildOfflineSelectorReviewQueue(
    report([row('baseline_missing',verified('true-primitive'))]))
  assert.equal(output.actions[0].priority,'P2')
  assert.equal(output.rightsVerified,false)
  assert.equal(output.selectorVerified,false)
  assert.equal(output.productionReady,false)
  assert.equal(output.m5Eligible,false)
})
test('M5 unchanged primitive historical/current pair remains P3',()=>{
  const s=verified('p3-fake')
  const output=buildOfflineSelectorReviewQueue(report(
    [row('unchanged',s,structuredClone(s))],true))
  assert.equal(output.actions[0].priority,'P3')
  assert.equal(output.actions[0].selectorVerified,false)
  assert.doesNotMatch(JSON.stringify(output),/p3-fake|fictional-store/)
})
test('M5 historical unavailable remains P1 without reading any digest',()=>{
  const output=buildOfflineSelectorReviewQueue(report(
    [row('unavailable',unavailable('p1-no-digest'))]))
  assert.equal(output.actions[0].priority,'P1')
  assert.equal(output.productionReady,false)
})
test('M5 genuine memory-only captureShape to compareInspections to queue remains supported',()=>{
  const s={
    id:'fake-canonical',supermarket:'plus',kind:'product',success:true,
    integrity:'verified',manifestSha256:A,
    html:{hasNextData:false,applicationJsonScripts:[],jsonLd:[{
      type:['Product'],keys:['@type','name'],
    }]},
    schemaOrgProduct:{type:'observation',observation:{name:'private-fake-item'}},
  }
  const canonical=captureShape(s)
  assert.equal(typeof canonical.snapshotSha256,'string')
  assert.equal(typeof canonical.shapeSha256,'string')
  const comparison=compareInspections({sourceCount:1,sources:[s]},
    {sourceCount:1,sources:[structuredClone(s)]})
  const q=buildOfflineSelectorReviewQueue(comparison)
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.m5Eligible,false)
  assert.equal(q.productionReady,false)
  assert.equal(q.rightsVerified,false)
  assert.doesNotMatch(JSON.stringify(q),/fake-canonical|private-fake-item/)
})
