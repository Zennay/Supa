import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All in-memory mock HTML and source names are fictitious; never fetch stores.
const failure = /^Error: Invalid or unbounded inspected HTML shape$/
const malformed = { type:[], keys:[], parseError:true }
const mock = (jsonLd=[]) => ({
  id:'fake-source',supermarket:'fictional-shop',kind:'product',
  success:true,integrity:'verified',manifestSha256:'a'.repeat(64),
  schemaOrgProduct:{type:'abstain'},
  html:{hasNextData:false,jsonLd,applicationJsonScripts:[]},
})
const reject = (record) => {
  const input=mock([record])
  const before=structuredClone(input)
  assert.throws(()=>captureShape(input),failure)
  assert.deepEqual(input,before)
}
const inspection = (rec) => ({sourceCount:1,sources:[rec]})

test('M5 malformed JSON-LD: cannot invent Product type on a parseError record',()=>{
  reject({type:['Product'],keys:[],parseError:true})
})

test('M5 malformed JSON-LD: cannot invent price keys on an error record',()=>{
  reject({type:[],keys:['offers'],parseError:true})
})

test('M5 malformed JSON-LD: cannot invent simultaneous type and keys on error',()=>{
  reject({type:['Product'],keys:['@type','offers'],parseError:true})
})

test('M5 malformed JSON-LD: empty-error record exactly matches M1 output and counts one parse error',()=>{
  const rec=mock([structuredClone(malformed)])
  const original=structuredClone(rec)
  const shape=captureShape(rec)
  assert.equal(shape.captureStatus,'verified')
  assert.equal(shape.jsonLdParseErrors,1)
  assert.equal(shape.jsonLdCount,1)
  assert.match(shape.shapeSha256,/^[a-f0-9]{64}$/)
  assert.deepEqual(rec,original)
})

test('M5 malformed JSON-LD: valid Product type and offer keys without error remain canonical',()=>{
  const item=mock([{type:['Product'],keys:['@type','name','offers']}])
  const result=captureShape(item)
  assert.equal(result.jsonLdCount,1)
  assert.equal(result.jsonLdParseErrors,0)
})

test('M5 malformed JSON-LD: truly absent parseError remains canonical even for empty arrays',()=>{
  const result=captureShape(mock([{type:[],keys:[]}]))
  assert.equal(result.jsonLdParseErrors,0)
})

test('M5 malformed JSON-LD: explicit false/string/coerced error markers remain rejected',()=>{
  for(const marker of [false,0,'true',null,[],{}]) {
    reject({type:[],keys:[],parseError:marker})
  }
})

test('M5 malformed JSON-LD: malformed arrays/holes cannot masquerade as valid empty error descriptors',()=>{
  const missingType={keys:[],parseError:true}
  const missingKeys={type:[],parseError:true}
  const holeType={type:new Array(1),keys:[],parseError:true}
  const holeKey={type:[],keys:new Array(1),parseError:true}
  for(const item of [missingType,missingKeys,holeType,holeKey]) {
    const source=mock([item])
    assert.throws(()=>captureShape(source),failure)
  }
})

test('M5 malformed JSON-LD: fake contradictory parse errors fail before comparing or queueing',()=>{
  const altered=mock([{type:['Product'],keys:[],parseError:true}])
  assert.throws(()=>compareInspections(inspection(altered),inspection(mock())),failure)
})

test('M5 malformed JSON-LD: actual M1 inspectHtml malformed JSON yields exact canonical failed record',()=>{
  const html='<html><script type="application/ld+json">{not-valid-json}</script></html>'
  const rec=mock()
  rec.manifestSha256=createHash('sha256').update(html).digest('hex')
  rec.html=inspectHtml(html)
  assert.deepEqual(rec.html.jsonLd,[malformed])
  assert.equal(captureShape(rec).jsonLdParseErrors,1)
  const same=compareInspections(inspection(rec),inspection(structuredClone(rec)))
  const queue=buildOfflineSelectorReviewQueue(same)
  assert.equal(queue.actions[0].priority,'P3')
  assert.equal(queue.summary.statusCounts.unchanged,1)
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(queue),/fake-source|fictional-shop|not-valid-json/)
})

test('M5 malformed JSON-LD: genuinely different HTML with parsed Product is valid P1 shape review',()=>{
  const validHtml='<html><script type="application/ld+json">{"@type":"Product","name":"Fake"}</script></html>'
  const invalidHtml='<html><script type="application/ld+json">{bad-json}</script></html>'
  const make = html => {
    const rec=mock()
    rec.manifestSha256=createHash('sha256').update(html).digest('hex')
    rec.html=inspectHtml(html)
    return rec
  }
  const report=compareInspections(inspection(make(validHtml)),inspection(make(invalidHtml)))
  assert.equal(report.changes[0].status,'shape_changed')
  assert.notEqual(report.changes[0].current.snapshotSha256,report.changes[0].baseline.snapshotSha256)
  const queue=buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.actions[0].priority,'P1')
  assert.equal(queue.actions[0].selectorVerified,false)
  assert.equal(queue.actions[0].rightsVerified,false)
  assert.equal(queue.actions[0].productionEnabled,false)
})

test('M5 malformed JSON-LD: multiple genuine failed script parses remain countable without invented types',()=>{
  const result=captureShape(mock([structuredClone(malformed),structuredClone(malformed)]))
  assert.equal(result.jsonLdCount,2)
  assert.equal(result.jsonLdParseErrors,2)
})
