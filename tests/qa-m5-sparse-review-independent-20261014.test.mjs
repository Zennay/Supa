import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independently invented in-memory offline review records. No real retailer/user data.
const H='a'.repeat(64)
const verified=id=>({id,captureStatus:'verified',snapshotSha256:H,
  shapeSha256:H,schemaOrgStatus:'abstain',supermarket:'fictional',kind:'product',
  hasNextData:false,jsonLdCount:0,jsonLdParseErrors:0})
const unavailable=id=>({id,captureStatus:'unavailable',snapshotSha256:null,
  shapeSha256:null,schemaOrgStatus:'unknown',supermarket:'fictional',kind:'product'})
const row=(id,status,current,baseline)=>({id,status,current,baseline})
const unchanged=id=>row(id,'unchanged',verified(id),verified(id))
function report(changes,{baselineProvided=true,current,drift}={}){
  return {contractVersion:1,mode:'offline_capture_signature_review_only',
    baselineProvided,productionReady:false,m5Eligible:false,
    reviewerActionRequired:true,captureCount:current??changes.filter(x=>x?.current!==null).length,
    driftCount:drift??changes.filter(x=>['removed','unavailable','added','shape_changed','origin_changed'].includes(x?.status)).length,
    changes}
}
const fail=r=>assert.throws(()=>buildOfflineSelectorReviewQueue(r),
  err=>err instanceof Error && err.message==='Invalid offline capture comparison report')
const privateFlags=v=>{
  for(const key of ['selectorVerified','rightsVerified','productionReady','m5Eligible'])assert.equal(v[key],false)
  assert.equal(v.actions.every(x=>!x.productionEnabled),true)
}
test('independent sparse queue: single all-hole array rejects, never emits JSON-null work',()=>{
  const list=new Array(1);const before=Object.keys(list)
  fail(report(list,{current:0,drift:0}))
  assert.deepEqual(Object.keys(list),before);assert.equal(list.length,1)
})
test('independent sparse queue: 200 all-hole review actions reject at maximum',()=>{
  fail(report(new Array(200),{current:0,drift:0}))
})
test('independent sparse queue: leading gap cannot hide a following valid P3',()=>{
  const list=new Array(2);list[1]=unchanged('later')
  fail(report(list,{current:1,drift:0}))
})
test('independent sparse queue: trailing gap cannot hide a prior valid P3',()=>{
  const list=[unchanged('first')];list.length=2
  fail(report(list,{current:1,drift:0}))
})
test('independent sparse queue: middle gap cannot hide two valid P3 rows',()=>{
  const list=[unchanged('one'),unchanged('two'),unchanged('three')]
  delete list[1];fail(report(list,{current:2,drift:0}))
})
test('independent sparse queue: 200-size boundary with just one real record rejects',()=>{
  const list=new Array(200);list[199]=unchanged('last')
  fail(report(list,{current:1,drift:0}))
})
test('independent sparse queue: prototype-inherited record cannot substitute for missing own index',()=>{
  const list=new Array(1)
  Object.setPrototypeOf(list,Object.assign(Object.create(Array.prototype),{0:unchanged('inherited')}))
  fail(report(list,{current:1,drift:0}))
  assert.equal(Object.hasOwn(list,0),false)
})
test('independent disguised change array: named fields do not make array a record',()=>{
  const list=[Object.assign([],unchanged('array-change'))]
  fail(report(list,{current:1,drift:0}))
})
test('independent disguised current snapshot array rejects despite verified fields',()=>{
  const x=unchanged('current-array');x.current=Object.assign([],x.current)
  fail(report([x],{current:1,drift:0}))
})
test('independent disguised historical snapshot array rejects despite verified fields',()=>{
  const x=unchanged('historical-array');x.baseline=Object.assign([],x.baseline)
  fail(report([x],{current:1,drift:0}))
})
test('independent valid dense P1 unavailable remains reviewer-only',()=>{
  const a=row('failed','unavailable',unavailable('failed'),null)
  const out=buildOfflineSelectorReviewQueue(report([a],{current:1,drift:1}))
  assert.equal(out.actions.length,1);assert.equal(out.actions[0].priority,'P1')
  privateFlags(out)
})
test('independent valid dense P2 baseline missing remains reviewer-only',()=>{
  const a=row('first','baseline_missing',verified('first'),null)
  const out=buildOfflineSelectorReviewQueue(report([a],{baselineProvided:false,current:1,drift:0}))
  assert.equal(out.actions.length,1);assert.equal(out.actions[0].priority,'P2')
  privateFlags(out)
})
test('independent valid dense P3 unchanged remains reviewer-only',()=>{
  const out=buildOfflineSelectorReviewQueue(report([unchanged('old')],{current:1,drift:0}))
  assert.equal(out.actions.length,1);assert.equal(out.actions[0].priority,'P3')
  privateFlags(out)
})
test('independent valid 200 dense rows preserve private actions with separately capped history',()=>{
  // New #2241 physical-cohort rule: 100 unchanged + 100 removed would contain
  // 200 historical snapshots. Use disjoint current/baseline cohorts instead.
  const changes=[]
  for(let n=0;n<100;n++)changes.push(row('current'+n,'added',verified('current'+n),null))
  for(let n=0;n<100;n++)changes.push(row('removed'+n,'removed',null,verified('removed'+n)))
  const before=JSON.stringify(changes)
  const out=buildOfflineSelectorReviewQueue(report(changes,{current:100,drift:200}))
  assert.equal(out.actions.length,200)
  assert.equal(out.sourceCount,100);assert.equal(out.driftCount,200)
  assert.equal(out.actions.filter(x=>x.priority==='P1').length,100)
  assert.equal(out.actions.filter(x=>x.priority==='P2').length,100)
  assert.equal(JSON.stringify(changes),before)
  privateFlags(out)
})
test('independent over-limit 201 dense entries reject without producing queue',()=>{
  const changes=Array.from({length:201},(_,n)=>unchanged('dense'+n))
  fail(report(changes,{current:100,drift:0}))
})
