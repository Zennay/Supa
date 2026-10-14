import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Pure offline/fictitious inputs. No retailer access, prices or real captures.
const MAX_HTML_BYTES = 8 * 1024 * 1024
const source = (scripts=[]) => ({
  id:'fictional-source', supermarket:'fictional-market', kind:'product',
  success:true, integrity:'verified', manifestSha256:'a'.repeat(64),
  schemaOrgProduct:{type:'abstain'},
  html:{hasNextData:false,jsonLd:[],applicationJsonScripts:scripts},
})
const script = (bytes, id=null) => ({id,bytes})
const invalid = /^Error: Invalid or unbounded inspected HTML shape$/
const refuse = (item) => {
  const frozen=structuredClone(item)
  assert.throws(()=>captureShape(item),invalid)
  assert.deepEqual(item,frozen)
}
const fingerprint = (item) => {
  const before=structuredClone(item)
  const result=captureShape(item)
  assert.match(result.shapeSha256,/^[0-9a-f]{64}$/)
  assert.deepEqual(item,before)
  return result
}

test('M5 physical script budget: one descriptor beyond 8MiB must be refused',()=>{
  refuse(source([script(MAX_HTML_BYTES+1)]))
})

test('M5 physical script budget: two individually bounded descriptors may not exceed combined 8MiB',()=>{
  refuse(source([script(4*1024*1024+1),script(4*1024*1024)]))
})

test('M5 physical script budget: 128 individually valid scripts cannot exceed aggregate physical HTML',()=>{
  refuse(source(Array.from({length:128},()=>script(64*1024+1))))
})

test('M5 physical script budget: exact 8MiB count allowed as permissive pure in-memory boundary',()=>{
  const result=fingerprint(source([script(MAX_HTML_BYTES)]))
  assert.equal(result.captureStatus,'verified')
  assert.equal(result.hasNextData,false)
})

test('M5 physical script budget: 128 scripts totalling 8MiB preserve canonical shape',()=>{
  const result=fingerprint(source(Array.from({length:128},(_,i)=>script(64*1024,i===0?'state':null))))
  assert.equal(result.captureStatus,'verified')
  assert.equal(result.jsonLdCount,0)
})

test('M5 physical script budget: exact limit followed by one byte is refused',()=>{
  refuse(source([script(MAX_HTML_BYTES),script(1)]))
})

test('M5 physical script budget: impossible script ID beyond physical HTML bytes is refused',()=>{
  refuse(source([script(0,'x'.repeat(MAX_HTML_BYTES+1))]))
})

test('M5 physical script budget: script ID at loose physical boundary is accepted without exposing ID',()=>{
  const shape=fingerprint(source([script(0,'x'.repeat(MAX_HTML_BYTES))]))
  assert.equal(shape.captureStatus,'verified')
  assert.equal(JSON.stringify(shape).includes('x'.repeat(100)),false)
})

test('M5 physical script budget: null and empty IDs, zero scripts, zero body remain valid',()=>{
  for(const scripts of [[],[script(0)],[script(0,'')],[script(0,null)]]) {
    fingerprint(source(scripts))
  }
})

test('M5 physical script budget: only safe scalar script lengths accepted',()=>{
  for(const value of [-1, 1.5, '123', null, Number.POSITIVE_INFINITY,Number.MAX_SAFE_INTEGER]) {
    refuse(source([script(value)]))
  }
})

test('M5 physical script budget: unexpected oversized inspected shape does not create P1/P3 review',()=>{
  const invalidSource=source([script(MAX_HTML_BYTES+1)])
  const validSource=source([])
  assert.throws(()=>compareInspections(
    {sourceCount:1,sources:[invalidSource]},
    {sourceCount:1,sources:[validSource]},
  ),invalid)
})

test('M5 physical script budget: real invented M1 parser scripts produce stable P3 human-only review',()=>{
  const html='<html><script id="state" type="application/json">{"flag":true}</script></html>'
  const rec=source()
  rec.manifestSha256=createHash('sha256').update(html).digest('hex')
  rec.html=inspectHtml(html)
  const data=compareInspections({sourceCount:1,sources:[rec]},
    {sourceCount:1,sources:[structuredClone(rec)]})
  const output=buildOfflineSelectorReviewQueue(data)
  assert.equal(output.actions[0].priority,'P3')
  assert.equal(output.productionReady,false)
  assert.equal(output.m5Eligible,false)
  assert.equal(output.actions[0].selectorVerified,false)
  assert.equal(output.actions[0].rightsVerified,false)
  assert.doesNotMatch(JSON.stringify(output),/fictional-source|fictional-market|state/)
})
