import assert from 'node:assert/strict'
import test from 'node:test'

import { compareInspections, captureShape } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const SHA='a'.repeat(64)
const cohort=(sources)=>({sourceCount:sources.length,sources})
const product=(id='fictional-product')=>({
  id,supermarket:'plus',kind:'product',success:true,integrity:'verified',
  manifestSha256:SHA,
  html:{hasNextData:false,jsonLd:[{type:['Product'],keys:['@type','name']}],
    applicationJsonScripts:[]},
  schemaOrgProduct:{type:'observation',observation:{name:'FAKE-PRIVATE-PRODUCT'}},
})
const failed=(id='fictional-failure')=>({
  id,supermarket:'plus',kind:'product',success:false,
})
const deny=(baseline)=>assert.throws(
  ()=>compareInspections(cohort([product()]),baseline),
  /^Error: Invalid or unbounded baseline inspection$/,
)
test('false baseline must be invalid, not silently treated as absent',()=>deny(false))
test('zero baseline must be invalid, not silently treated as absent',()=>deny(0))
test('negative zero baseline must be invalid, not silently treated as absent',()=>deny(-0))
test('empty string baseline must be invalid, not silently treated as absent',()=>deny(''))
test('NaN baseline must be invalid, not silently treated as absent',()=>deny(Number.NaN))
test('bigint zero baseline must be invalid, not silently treated as absent',()=>deny(0n))
test('undefined baseline is a permitted omitted legacy sentinel',()=>{
  const out=compareInspections(cohort([product()]),undefined)
  assert.equal(out.baselineProvided,false)
  assert.equal(out.changes[0].status,'baseline_missing')
  assert.equal(out.m5Eligible,false)
})
test('null baseline is the explicit supported absence sentinel',()=>{
  const out=compareInspections(cohort([product()]),null)
  assert.equal(out.baselineProvided,false)
  assert.equal(out.changes[0].status,'baseline_missing')
})
test('omitted second argument still produces a P2 missing baseline',()=>{
  const q=buildOfflineSelectorReviewQueue(compareInspections(cohort([product()])))
  assert.equal(q.actions[0].priority,'P2')
  assert.equal(q.productionReady,false)
  assert.equal(q.rightsVerified,false)
  assert.equal(q.m5Eligible,false)
})
test('empty valid historical cohort counts as actually supplied baseline',()=>{
  const out=compareInspections(cohort([product()]),cohort([]))
  assert.equal(out.baselineProvided,true)
  assert.equal(out.changes[0].status,'added')
  const q=buildOfflineSelectorReviewQueue(out)
  assert.equal(q.actions[0].priority,'P2')
  assert.equal(q.actions[0].status,'added')
  assert.equal(q.m5Eligible,false)
})
test('empty valid history plus empty current still remembers baseline',()=>{
  const out=compareInspections(cohort([]),cohort([]))
  assert.equal(out.baselineProvided,true)
  assert.equal(out.captureCount,0)
  assert.equal(out.changes.length,0)
  const q=buildOfflineSelectorReviewQueue(out)
  assert.equal(q.summary.actionCount,0)
  assert.equal(q.productionReady,false)
})
test('true historical Product with same bytes remains manual P3',()=>{
  const same=product('PRIVATE-SOURCE-ID')
  assert.equal(captureShape(same).schemaOrgStatus,'candidate_observation')
  const out=compareInspections(cohort([same]),cohort([structuredClone(same)]))
  assert.equal(out.baselineProvided,true)
  const q=buildOfflineSelectorReviewQueue(out)
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.rightsVerified,false)
  assert.equal(q.selectorVerified,false)
  assert.equal(q.productionReady,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE-SOURCE-ID|FAKE-PRIVATE-PRODUCT/)
})
test('failed current observation with no historical pair remains P1',()=>{
  const q=buildOfflineSelectorReviewQueue(compareInspections(cohort([failed()])))
  assert.equal(q.actions[0].priority,'P1')
  assert.equal(q.m5Eligible,false)
})
test('historical Product disappearing from current cohort remains P1',()=>{
  const q=buildOfflineSelectorReviewQueue(compareInspections(cohort([]),cohort([product('PRIVATE-MISSING')])))
  assert.equal(q.actions[0].status,'removed')
  assert.equal(q.actions[0].priority,'P1')
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE-MISSING/)
})
test('falsy invalid baseline is rejected before inspecting current malicious source getters',()=>{
  let called=0
  const source=product()
  Object.defineProperty(source,'id',{get(){called++;throw Error('PRIVATE')}})
  assert.throws(()=>compareInspections(cohort([source]),false),
    /^Error: Invalid or unbounded baseline inspection$/)
  assert.equal(called,0)
})
test('boxed Boolean(false) is not a valid absent baseline',()=>deny(new Boolean(false)))
test('boxed Number(0) is not a valid absent baseline',()=>deny(new Number(0)))
test('empty array is not a valid historical cohort object',()=>deny([]))
test('valid empty sources with malformed count cannot be promoted to missing',()=>{
  deny({sourceCount:1,sources:[]})
})
test('baseline object getter cannot supply fake history after falsy safeguards',()=>{
  let called=0
  const raw=cohort([product()])
  Object.defineProperty(raw,'sources',{get(){called++;throw Error('PRIVATE')}})
  assert.throws(()=>compareInspections(cohort([product()]),raw),
    /^Error: Invalid or unbounded baseline inspection$/)
  assert.equal(called,0)
})
