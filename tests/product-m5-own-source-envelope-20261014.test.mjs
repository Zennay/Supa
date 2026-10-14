import assert from 'node:assert/strict'
import test from 'node:test'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Invented local HTML summaries only; no real retailer, customers or prices.
const SHA='a'.repeat(64)
function source(decision='observation'){
  const obj={id:'private-fake-src',supermarket:'plus',kind:'product',
    success:true,integrity:'verified',manifestSha256:SHA,
    html:{hasNextData:false,jsonLd:[{type:['Product'],keys:['@type','name']}],
      applicationJsonScripts:[]},
    schemaOrgProduct:decision==='observation'
      ?{type:'observation',observation:{name:'PRIVATE-NAME'}}:{type:'abstain'}}
  if(decision==='abstain')obj.html.jsonLd=[]
  return obj
}
function failure(){
  return {id:'private-failed-src',supermarket:'plus',kind:'product',success:false}
}
function getterGuard(input,key,expectedError){
  let calls=0
  Object.defineProperty(input,key,{configurable:true,enumerable:true,
    get(){calls++;throw Error('PRIVATE-NEVER-EXECUTE')}})
  assert.throws(()=>captureShape(input),new RegExp(expectedError))
  assert.equal(calls,0)
}
test('pure M5 refuses source id getter before origin validation',()=>{
  getterGuard(source(),'id','Invalid inspected source')
})
test('pure M5 refuses supermarket getter before origin validation',()=>{
  getterGuard(source(),'supermarket','Invalid inspected source origin')
})
test('pure M5 refuses source kind getter before origin validation',()=>{
  getterGuard(source(),'kind','Invalid inspected source origin')
})
test('pure M5 refuses success getter before Boolean check',()=>{
  getterGuard(source(),'success','Invalid inspected capture success')
})
test('pure M5 refuses integrity getter without running caller code',()=>{
  getterGuard(source(),'integrity','Snapshot integrity verification required')
})
test('pure M5 refuses digest getter without running caller code',()=>{
  getterGuard(source(),'manifestSha256','Snapshot integrity verification required')
})
test('pure M5 refuses inherited id getter and never invokes it',()=>{
  const v=source()
  let calls=0
  Object.setPrototypeOf(v,Object.defineProperty({},'id',{get(){calls++;throw Error('PRIVATE')}}))
  delete v.id
  assert.throws(()=>captureShape(v),/Invalid inspected source/)
  assert.equal(calls,0)
})
test('pure M5 refuses inherited store or kind metadata',()=>{
  for(const field of ['supermarket','kind']){
    const v=source()
    delete v[field]
    assert.throws(()=>captureShape(v),/Invalid inspected source origin/)
  }
})
test('pure M5 refuses inherited success getter on unavailable capture',()=>{
  const v=failure()
  let calls=0
  Object.setPrototypeOf(v,Object.defineProperty({},'success',{get(){calls++;return false}}))
  delete v.success
  assert.throws(()=>captureShape(v),/Invalid inspected capture success/)
  assert.equal(calls,0)
})
test('pure M5 refuses inherited snapshot digest getter on successful capture',()=>{
  const v=source()
  let calls=0
  Object.setPrototypeOf(v,Object.defineProperty({},'manifestSha256',{
    get(){calls++;return SHA}}))
  delete v.manifestSha256
  assert.throws(()=>captureShape(v),/Snapshot integrity verification required/)
  assert.equal(calls,0)
})
test('pure M5 refuses wrapped or coercible SHA-256 values before regex',()=>{
  for(const candidate of [new String(SHA),[SHA],{toString(){throw Error('PRIVATE')}}]){
    const v=source()
    v.manifestSha256=candidate
    assert.throws(()=>captureShape(v),/Snapshot integrity verification required/)
  }
})
test('pure M5 does not run custom digest ToString or Symbol.toPrimitive',()=>{
  for(const name of ['toString',Symbol.toPrimitive]){
    let calls=0
    const value={[name](){calls++;throw Error('PRIVATE')}}
    const v=source()
    v.manifestSha256=value
    assert.throws(()=>captureShape(v),/Snapshot integrity verification required/)
    assert.equal(calls,0)
  }
})
test('pure M5 refuses source success number and string without coercion',()=>{
  for(const value of [null,undefined,0,1,'true','false',{},[]]){
    const v=source()
    v.success=value
    assert.throws(()=>captureShape(v),/Invalid inspected capture success/)
  }
})
test('pure M5 refuses missing own success/integrity/hash fields',()=>{
  for(const field of ['success','integrity','manifestSha256']){
    const v=source()
    delete v[field]
    assert.throws(()=>captureShape(v),field==='success'
      ?/Invalid inspected capture success/:/Snapshot integrity verification required/)
  }
})
test('pure M5 unavailable capture uses own pinned source origin and stays P1',()=>{
  const v=failure()
  assert.equal(captureShape(v).captureStatus,'unavailable')
  const q=buildOfflineSelectorReviewQueue(compareInspections({sourceCount:1,sources:[v]}))
  assert.equal(q.actions[0].priority,'P1')
  assert.equal(q.productionReady,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/private-failed-src/)
})
test('pure M5 unavailable capture refuses getter origin',()=>{
  getterGuard(failure(),'kind','Invalid inspected source origin')
})
test('pure M5 genuine synthetic Product HTML keeps stable P3 manual only',()=>{
  const v=source()
  const before=structuredClone(v)
  const shape=captureShape(v)
  assert.deepEqual(v,before)
  assert.equal(shape.schemaOrgStatus,'candidate_observation')
  assert.equal(shape.snapshotSha256,SHA)
  const q=buildOfflineSelectorReviewQueue(compareInspections(
    {sourceCount:1,sources:[v]},{sourceCount:1,sources:[structuredClone(v)]}))
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.rightsVerified,false)
  assert.equal(q.selectorVerified,false)
  assert.equal(q.productionReady,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE-NAME|private-fake-src/)
})
test('pure M5 canonical abstention from no JSON-LD stays human P2',()=>{
  const v=source('abstain')
  const shape=captureShape(v)
  assert.equal(shape.schemaOrgStatus,'abstain')
  const q=buildOfflineSelectorReviewQueue(compareInspections({sourceCount:1,sources:[v]}))
  assert.equal(q.actions[0].priority,'P2')
  assert.equal(q.m5Eligible,false)
})
