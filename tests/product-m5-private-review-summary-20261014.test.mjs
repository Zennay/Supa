import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const HA = 'a'.repeat(64)
const HB = 'b'.repeat(64)
const SA = 'c'.repeat(64)
const SB = 'd'.repeat(64)
const verified = (id, options={}) => ({
  id, supermarket:'fictional-shop', kind:'product', captureStatus:'verified',
  snapshotSha256:HA, shapeSha256:SA, schemaOrgStatus:'abstain',
  hasNextData:false, jsonLdCount:0, jsonLdParseErrors:0, ...options,
})
const unavailable = (id) => ({
  id, supermarket:'fictional-shop', kind:'product', captureStatus:'unavailable',
  snapshotSha256:null, shapeSha256:null, schemaOrgStatus:'unknown',
})
const line = (id,status,current,baseline=null) => ({id,status,current,baseline})
const DRIFT = new Set(['removed','unavailable','origin_changed','shape_changed','added'])
const report = (changes, baselineProvided=true) => ({
  contractVersion:1, mode:'offline_capture_signature_review_only',
  productionReady:false,m5Eligible:false,reviewerActionRequired:true,
  baselineProvided, captureCount:changes.filter(x=>x.current!==null).length,
  driftCount:changes.filter(x=>DRIFT.has(x.status)).length, changes,
})
const allStatuses = ['unavailable','origin_changed','removed','shape_changed',
  'added','baseline_missing','content_changed_shape_stable','unchanged']
const zeroStatusCounts = Object.fromEntries(allStatuses.map(k=>[k,0]))

function presentSeven() {
  const changedOrigin = verified('s-origin', {supermarket:'fictional-shop-v2'})
  return report([
    line('s-removed','removed',null,verified('s-removed')),
    line('s-unavailable','unavailable',unavailable('s-unavailable'),verified('s-unavailable')),
    line('s-origin','origin_changed',changedOrigin,verified('s-origin')),
    line('s-shape','shape_changed',verified('s-shape',{snapshotSha256:HB,shapeSha256:SB}),verified('s-shape')),
    line('s-added','added',verified('s-added')),
    line('s-content','content_changed_shape_stable',verified('s-content',{snapshotSha256:HB}),verified('s-content')),
    line('s-unchanged','unchanged',verified('s-unchanged'),verified('s-unchanged')),
  ])
}

test('M5 human review summary: exactly seven canonical statuses produce true P1/P2/P3 totals', () => {
  const input = presentSeven()
  const before = structuredClone(input)
  const result = buildOfflineSelectorReviewQueue(input)
  assert.deepEqual(result.summary.priorityCounts,{P1:4,P2:2,P3:1})
  assert.deepEqual(result.summary.statusCounts,{
    ...zeroStatusCounts,
    unavailable:1,origin_changed:1,removed:1,shape_changed:1,added:1,
    content_changed_shape_stable:1,unchanged:1,
  })
  assert.equal(result.summary.actionCount,7)
  assert.equal(Object.values(result.summary.statusCounts).reduce((a,b)=>a+b,0),7)
  assert.equal(Object.values(result.summary.priorityCounts).reduce((a,b)=>a+b,0),7)
  assert.equal(result.productionReady,false)
  assert.equal(result.m5Eligible,false)
  assert.deepEqual(input,before)
})

test('M5 human review summary: no-baseline P1 capture failure and P2 baseline-needed remain explicit', () => {
  const input=report([
    line('new-success','baseline_missing',verified('new-success')),
    line('new-failure','unavailable',unavailable('new-failure')),
  ],false)
  const result=buildOfflineSelectorReviewQueue(input)
  assert.deepEqual(result.summary.priorityCounts,{P1:1,P2:1,P3:0})
  assert.equal(result.summary.statusCounts.baseline_missing,1)
  assert.equal(result.summary.statusCounts.unavailable,1)
  assert.equal(result.summary.statusCounts.removed,0)
  assert.equal(result.summary.actionCount,2)
  assert.equal(result.baselineProvided,false)
})

test('M5 human review summary: empty review is explicit zeros, not missing keys', () => {
  for(const baselineProvided of [true,false]){
    const result=buildOfflineSelectorReviewQueue(report([],baselineProvided))
    assert.deepEqual(result.summary.priorityCounts,{P1:0,P2:0,P3:0})
    assert.deepEqual(result.summary.statusCounts,zeroStatusCounts)
    assert.equal(result.summary.actionCount,0)
    assert.deepEqual(result.actions,[])
    assert.equal(result.reviewerActionRequired,true)
    assert.equal(result.m5Eligible,false)
  }
})

test('M5 human review summary: totals and order survive permutation without source leakage', () => {
  const first=presentSeven()
  const reversed=report([...first.changes].reverse())
  const a=buildOfflineSelectorReviewQueue(first)
  const b=buildOfflineSelectorReviewQueue(reversed)
  assert.deepEqual(a,b)
  assert.doesNotMatch(JSON.stringify(a),/s-removed|s-unavailable|s-origin|fictional-shop|s-added/)
  assert.ok(a.actions.every(x=>/^[a-f0-9]{64}$/.test(x.sourceToken) &&
    x.productionEnabled===false && x.rightsVerified===false && x.selectorVerified===false))
})

test('M5 human review summary: physical 100 current plus 100 old sources total exactly 200 actions', () => {
  const rows=[
    ...Array.from({length:100},(_,i)=>{const id='old-'+i;return line(id,'removed',null,verified(id))}),
    ...Array.from({length:100},(_,i)=>{const id='new-'+i;return line(id,'added',verified(id))}),
  ]
  const input=report(rows)
  const frozen=structuredClone(input)
  const out=buildOfflineSelectorReviewQueue(input)
  assert.equal(out.summary.actionCount,200)
  assert.deepEqual(out.summary.priorityCounts,{P1:100,P2:100,P3:0})
  assert.equal(out.summary.statusCounts.removed,100)
  assert.equal(out.summary.statusCounts.added,100)
  assert.equal(out.sourceCount,100)
  assert.deepEqual(input,frozen)
})

test('M5 human review summary: unknown extra input summary cannot forge validated action totals', () => {
  const input=presentSeven()
  input.summary={actionCount:999,priorityCounts:{P1:999},statusCounts:{unavailable:999}}
  const original=structuredClone(input)
  const output=buildOfflineSelectorReviewQueue(input)
  assert.equal(output.summary.actionCount,7)
  assert.deepEqual(output.summary.priorityCounts,{P1:4,P2:2,P3:1})
  assert.deepEqual(input,original)
  assert.doesNotMatch(JSON.stringify(output),/999/)
})

test('M5 human review summary: malformed report still throws instead of emitting a partial aggregate', () => {
  const input=presentSeven()
  input.changes[2].status='unchanged'
  assert.throws(()=>buildOfflineSelectorReviewQueue(input),
    /^Error: Invalid offline capture comparison report$/)
})

test('M5 human review summary: real M1 inspectHtml and M5 compare lead to private single P3', () => {
  const html='<html><script type="application/ld+json">{"@type":"Product"}</script></html>'
  const src={id:'canonical-source',supermarket:'fictional-shop',kind:'product',
    success:true,integrity:'verified',
    manifestSha256:createHash('sha256').update(html).digest('hex'),
    html:inspectHtml(html),schemaOrgProduct:{type:'abstain'}}
  const comparison=compareInspections({sourceCount:1,sources:[src]},
    {sourceCount:1,sources:[structuredClone(src)]})
  const queue=buildOfflineSelectorReviewQueue(comparison)
  assert.equal(queue.actions[0].priority,'P3')
  assert.deepEqual(queue.summary.priorityCounts,{P1:0,P2:0,P3:1})
  assert.equal(queue.summary.statusCounts.unchanged,1)
  assert.equal(queue.summary.actionCount,1)
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(queue),/canonical-source|fictional-shop/)
})
