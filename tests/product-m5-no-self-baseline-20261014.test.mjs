import assert from 'node:assert/strict'
import test from 'node:test'

import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All captures are invented, local, no retailer network or observed prices.
const SHA='a'.repeat(64)
function product(id='fake-store-item') {
  return {
    id,supermarket:'plus',kind:'product',success:true,integrity:'verified',
    manifestSha256:SHA,html:{hasNextData:false,
      jsonLd:[{type:['Product'],keys:['@type','name']}],
      applicationJsonScripts:[]},
    schemaOrgProduct:{type:'observation',observation:{name:'PRIVATE-FAKE-NAME'}},
  }
}
function unavailable(id='fake-capture-failure') {
  return {id,supermarket:'plus',kind:'product',success:false}
}
const cohort=(sources)=>({sourceCount:sources.length,sources})
const rejectHistory=(current,baseline)=>assert.throws(
  ()=>compareInspections(current,baseline),
  /^Error: Invalid or unbounded baseline inspection$/,
)
test('one cohort object cannot impersonate its own historical baseline',()=>{
  const current=cohort([product()])
  rejectHistory(current,current)
})
test('same empty cohort object cannot impersonate independent history',()=>{
  const current=cohort([])
  rejectHistory(current,current)
})
test('two different cohort objects sharing one original sources array are not independent',()=>{
  const sources=[product()]
  rejectHistory(cohort(sources),cohort(sources))
})
test('two distinct cohort objects sharing one empty sources array are not independent',()=>{
  const sources=[]
  rejectHistory(cohort(sources),cohort(sources))
})
test('historical array alias is rejected even when source object has been replaced',()=>{
  const sources=[product()]
  const now=cohort(sources)
  const past=cohort(sources)
  rejectHistory(now,past)
})
test('historical array alias is rejected on unavailable capture',()=>{
  const sources=[unavailable()]
  rejectHistory(cohort(sources),cohort(sources))
})
test('original source array stays unchanged after rejected alias',()=>{
  const sources=[product()]
  const frozen=structuredClone(sources)
  rejectHistory(cohort(sources),cohort(sources))
  assert.deepEqual(sources,frozen)
})
test('non-own current sources getter is rejected before alias check without execution',()=>{
  let calls=0
  const current=cohort([product()])
  Object.defineProperty(current,'sources',{get(){calls++;throw Error('PRIVATE')}})
  rejectHistory(current,cohort([product()]))
  assert.equal(calls,0)
})
test('historical sources getter is rejected before alias check without execution',()=>{
  let calls=0
  const baseline=cohort([product()])
  Object.defineProperty(baseline,'sources',{get(){calls++;throw Error('PRIVATE')}})
  rejectHistory(cohort([product()]),baseline)
  assert.equal(calls,0)
})
test('two independent arrays with identical frozen Product HTML remain valid P3',()=>{
  const source=product('PRIVATE-SAME-DEMAND')
  const now=cohort([source])
  const past=cohort([structuredClone(source)])
  assert.notStrictEqual(now.sources,past.sources)
  const q=buildOfflineSelectorReviewQueue(compareInspections(now,past))
  assert.equal(q.actions[0].status,'unchanged')
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.rightsVerified,false)
  assert.equal(q.selectorVerified,false)
  assert.equal(q.productionReady,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE-SAME-DEMAND|PRIVATE-FAKE-NAME/)
})
test('two independently allocated empty cohorts preserve genuine baseline-provided status',()=>{
  const result=compareInspections(cohort([]),cohort([]))
  assert.equal(result.baselineProvided,true)
  assert.equal(result.captureCount,0)
  assert.equal(result.changes.length,0)
})
test('new Product without history remains manual P2',()=>{
  const q=buildOfflineSelectorReviewQueue(compareInspections(cohort([product()])))
  assert.equal(q.actions[0].priority,'P2')
  assert.equal(q.m5Eligible,false)
})
test('explicit null history preserves canonical P2',()=>{
  const q=buildOfflineSelectorReviewQueue(compareInspections(cohort([product()]),null))
  assert.equal(q.actions[0].priority,'P2')
  assert.equal(q.productionReady,false)
})
test('current failed capture with no baseline remains manual P1',()=>{
  const q=buildOfflineSelectorReviewQueue(compareInspections(cohort([unavailable()])))
  assert.equal(q.actions[0].priority,'P1')
  assert.equal(q.rightsVerified,false)
})
test('disappeared historical Product still receives manual P1',()=>{
  const q=buildOfflineSelectorReviewQueue(compareInspections(
    cohort([]),cohort([product('PRIVATE-MISSING-PRODUCT')])))
  assert.equal(q.actions[0].status,'removed')
  assert.equal(q.actions[0].priority,'P1')
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/PRIVATE-MISSING-PRODUCT/)
})
test('invalid falsy historical value is still refused before inspecting source',()=>{
  const current=cohort([product()])
  for(const invalid of [false,0,'',Number.NaN])rejectHistory(current,invalid)
})
test('independent sources with same IDs but different HTML shape remain P1 human-only',()=>{
  const prior=product('FAKE-DRIFT')
  const latest=structuredClone(prior)
  latest.html.jsonLd[0].keys.push('@graph')
  const q=buildOfflineSelectorReviewQueue(compareInspections(
    cohort([latest]),cohort([prior])))
  assert.equal(q.actions[0].priority,'P1')
  assert.equal(q.rightsVerified,false)
  assert.equal(q.productionReady,false)
  assert.doesNotMatch(JSON.stringify(q),/FAKE-DRIFT/)
})
