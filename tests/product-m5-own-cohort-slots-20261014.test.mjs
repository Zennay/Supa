import assert from 'node:assert/strict'
import test from 'node:test'

import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Local invented M1 inspection envelopes; no retailer network/data.
const SHA='a'.repeat(64)
function good(id='synthetic') {
  return {id,supermarket:'plus',kind:'product',success:true,integrity:'verified',
    manifestSha256:SHA,html:{hasNextData:false,applicationJsonScripts:[],
      jsonLd:[{type:['Product'],keys:['@type','name']}]},
    schemaOrgProduct:{type:'observation',observation:{name:'PRIVATE-FAKE-LABEL'}}}
}
function failed(id='failed-fake') {
  return {id,supermarket:'plus',kind:'product',success:false}
}
const cohort=(sources)=>({sourceCount:sources.length,sources})
const reject=(v,baseline=null,label='current')=>
  assert.throws(()=>compareInspections(v,baseline),
    new RegExp('^Error: Invalid or unbounded '+label+' inspection$'))
function getterProbe(field,kind='current') {
  let called=0
  const original=cohort([good()])
  const other=cohort([good()])
  const target=kind==='current'?original:other
  Object.defineProperty(target,field,{enumerable:true,configurable:true,
    get(){called++;throw Error('PRIVATE-PRODUCT-NEVER-READ')}})
  reject(original,kind==='baseline'?other:null,kind)
  assert.equal(called,0)
}
test('current sources getter is never executed',()=>getterProbe('sources'))
test('current sourceCount getter is never executed',()=>getterProbe('sourceCount'))
test('historical sources getter is never executed',()=>getterProbe('sources','baseline'))
test('historical sourceCount getter is never executed',()=>getterProbe('sourceCount','baseline'))
test('current inherited sources getter is never executed',()=>{
  const input=cohort([good()])
  let calls=0
  Object.setPrototypeOf(input,Object.defineProperty({},'sources',{
    get(){calls++;throw Error('PRIVATE')}}))
  delete input.sources
  reject(input)
  assert.equal(calls,0)
})
test('historical inherited count getter is never executed',()=>{
  const baseline=cohort([good()])
  let calls=0
  Object.setPrototypeOf(baseline,Object.defineProperty({},'sourceCount',{
    get(){calls++;throw Error('PRIVATE')}}))
  delete baseline.sourceCount
  reject(cohort([good()]),baseline,'baseline')
  assert.equal(calls,0)
})
test('current missing sourceCount and sources fail with generic error',()=>{
  for(const name of ['sourceCount','sources']) {
    const value=cohort([good()])
    delete value[name]
    reject(value)
  }
})
test('historical missing sourceCount and sources fail generically',()=>{
  for(const name of ['sourceCount','sources']) {
    const value=cohort([good()])
    delete value[name]
    reject(cohort([good()]),value,'baseline')
  }
})
test('current own array slot accessor is never executed',()=>{
  const value=cohort([good()])
  let calls=0
  Object.defineProperty(value.sources,0,{get(){calls++;throw Error('PRIVATE')}})
  reject(value)
  assert.equal(calls,0)
})
test('historical own array slot getter is never executed',()=>{
  const value=cohort([good()])
  const old=cohort([good()])
  let calls=0
  Object.defineProperty(old.sources,0,{get(){calls++;throw Error('PRIVATE')}})
  reject(value,old,'baseline')
  assert.equal(calls,0)
})
test('sparse current and historical sources arrays are denied',()=>{
  const sparse=Array(1)
  reject({sources:sparse,sourceCount:1})
  reject(cohort([good()]),{sources:sparse,sourceCount:1},'baseline')
})
test('Array subclass with custom iterator cannot change inspected sources',()=>{
  const arr=[good()]
  let calls=0
  Object.defineProperty(arr,Symbol.iterator,{value(){calls++;throw Error('PRIVATE')}})
  const output=compareInspections({sources:arr,sourceCount:1})
  assert.equal(calls,0)
  assert.equal(output.changes[0].status,'baseline_missing')
  assert.equal(output.m5Eligible,false)
})
test('invalid or coercible current sourceCount denied before any conversion',()=>{
  for(const value of [NaN,Infinity,-1,1.1,'1',new Number(1),null,undefined,1n,Symbol('1')]) {
    const input=cohort([good()])
    input.sourceCount=value
    reject(input)
  }
})
test('invalid baseline sourceCount denied before any conversion',()=>{
  for(const value of ['1',new Number(1),1.25,2,-1,undefined]) {
    const before=cohort([good()])
    before.sourceCount=value
    reject(cohort([good()]),before,'baseline')
  }
})
test('current empty valid source cohort gives empty human review',()=>{
  const result=compareInspections(cohort([]))
  const queue=buildOfflineSelectorReviewQueue(result)
  assert.equal(result.captureCount,0)
  assert.equal(queue.summary.actionCount,0)
  assert.equal(queue.m5Eligible,false)
  assert.equal(queue.productionReady,false)
})
test('valid Product observation and identical historical HTML stay manual P3',()=>{
  const v=good('PRIVATE-SOURCE-IDENTITY')
  assert.equal(captureShape(v).schemaOrgStatus,'candidate_observation')
  const now=cohort([v])
  const before=cohort([structuredClone(v)])
  const frozenNow=structuredClone(now)
  const result=compareInspections(now,before)
  const queue=buildOfflineSelectorReviewQueue(result)
  assert.deepEqual(now,frozenNow)
  assert.equal(queue.actions[0].priority,'P3')
  assert.equal(queue.selectorVerified,false)
  assert.equal(queue.rightsVerified,false)
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(queue),/PRIVATE-SOURCE-IDENTITY|PRIVATE-FAKE-LABEL/)
})
test('valid new Product observation remains P2 human-only',()=>{
  const queue=buildOfflineSelectorReviewQueue(compareInspections(cohort([good()])))
  assert.equal(queue.actions[0].priority,'P2')
  assert.equal(queue.rightsVerified,false)
})
test('valid failed capture remains P1 and never implies source rights',()=>{
  const queue=buildOfflineSelectorReviewQueue(compareInspections(cohort([failed()])))
  assert.equal(queue.actions[0].priority,'P1')
  assert.equal(queue.rightsVerified,false)
  assert.equal(queue.m5Eligible,false)
})
test('valid historical source disappears and retains removed P1',()=>{
  const output=compareInspections(cohort([]),cohort([good('missing-source')]))
  const queue=buildOfflineSelectorReviewQueue(output)
  assert.equal(queue.actions[0].priority,'P1')
  assert.equal(queue.actions[0].status,'removed')
  assert.doesNotMatch(JSON.stringify(queue),/missing-source/)
})
test('duplicate source IDs still refuse comparison after cohort pinning',()=>{
  const repeated=good('duplicate')
  assert.throws(()=>compareInspections(cohort([repeated,structuredClone(repeated)])),/Duplicate capture source ID/)
})
