import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All observations/HTML are invented, never sourced from retail websites.
const ERROR = /^Error: Invalid inspected Schema.org parse result$/
const PARSE_ERROR = { type: [], keys: [], parseError: true }
const PRODUCT = { type: ['Product'], keys: ['@type','name'] }
const captured = (jsonLd, schemaOrgProduct = { type: 'abstain', reasons: [] }) => ({
  id: 'fictional-product', supermarket: 'fictional-store', kind: 'product',
  success: true, integrity: 'verified', manifestSha256: 'a'.repeat(64),
  html: { hasNextData: false, jsonLd, applicationJsonScripts: [] },
  schemaOrgProduct,
})
const candidate = (jsonLd=[PRODUCT], payload={name:'fictional-product'}) =>
  captured(jsonLd, { type:'observation', observation:payload })
function refuse(source) {
  const frozen=structuredClone(source)
  assert.throws(()=>captureShape(source),ERROR)
  assert.deepEqual(source,frozen)
}

test('M5 candidate evidence: cannot claim observation with zero JSON-LD records',()=>{
  refuse(candidate([]))
})

test('M5 candidate evidence: one genuine parse failure cannot support a positive observation',()=>{
  refuse(candidate([structuredClone(PARSE_ERROR)]))
})

test('M5 candidate evidence: multiple actual parser errors still cannot support a Product observation',()=>{
  refuse(candidate([structuredClone(PARSE_ERROR),structuredClone(PARSE_ERROR)]))
})

test('M5 candidate evidence: matching parsed Product metadata but missing observation object is rejected',()=>{
  refuse(captured([PRODUCT],{type:'observation'}))
})

test('M5 candidate evidence: null, arrays and scalar payloads cannot be positive M1 records',()=>{
  for(const payload of [null,[],['fake'],'fake',0,7,true,false]) {
    refuse(candidate([PRODUCT],payload))
  }
})

test('M5 candidate evidence: inherited observation record is not accepted',()=>{
  const parser=Object.create({observation:{name:'fake'}})
  parser.type='observation'
  const source=captured([PRODUCT],parser)
  assert.throws(()=>captureShape(source),ERROR)
})

test('M5 candidate evidence: getter-provided observation is never evaluated',()=>{
  let called=0
  const parser={type:'observation'}
  Object.defineProperty(parser,'observation',{enumerable:true,get(){
    called++;throw Error('private-sensitive-observation')
  }})
  const source=captured([PRODUCT],parser)
  assert.throws(()=>captureShape(source),ERROR)
  assert.equal(called,0)
})

test('M5 candidate evidence: abstention cannot hide a successful Product payload',()=>{
  refuse(captured([],{type:'abstain',observation:{name:'private'}}))
})

test('M5 candidate evidence: abstention cannot hide accessor-valued observation',()=>{
  let called=0
  const parser={type:'abstain'}
  Object.defineProperty(parser,'observation',{get(){called++;throw Error('private')}})
  assert.throws(()=>captureShape(captured([],parser)),ERROR)
  assert.equal(called,0)
})

test('M5 candidate evidence: empty parse list with legitimate abstention stays eligible for manual P2 baseline',()=>{
  const source=captured([])
  const report=compareInspections({sourceCount:1,sources:[source]})
  const queue=buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.actions[0].priority,'P2')
  assert.equal(queue.actions[0].selectorVerified,false)
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
})

test('M5 candidate evidence: failed M1 JSON-LD retains legitimate abstention and P3 with fixed HTML',()=>{
  const source=captured([structuredClone(PARSE_ERROR)])
  const report=compareInspections({sourceCount:1,sources:[source]},
    {sourceCount:1,sources:[structuredClone(source)]})
  const q=buildOfflineSelectorReviewQueue(report)
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.m5Eligible,false)
})

test('M5 candidate evidence: real M1 inspectHtml parses fictional Product and allows positive candidate only',()=>{
  const html='<html><script type="application/ld+json">{"@type":"Product","name":"Fictional"}</script></html>'
  const source=candidate(inspectHtml(html).jsonLd)
  source.html=inspectHtml(html)
  source.manifestSha256=createHash('sha256').update(html).digest('hex')
  const proof=captureShape(source)
  assert.equal(proof.schemaOrgStatus,'candidate_observation')
  // The internal pure shape still includes the source ID for matching; only
  // the public human review queue must redact it. Never echo Product payload.
  assert.equal(Object.hasOwn(proof,'observation'),false)
  assert.doesNotMatch(JSON.stringify(proof), /name":"Fictional"/)
  const comparison=compareInspections({sourceCount:1,sources:[source]},
    {sourceCount:1,sources:[structuredClone(source)]})
  const queue=buildOfflineSelectorReviewQueue(comparison)
  assert.equal(queue.actions[0].priority,'P3')
  assert.equal(queue.selectorVerified,false)
  assert.equal(queue.rightsVerified,false)
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(queue),/fictional-product|Fictional|fictional-store/)
})

test('M5 candidate evidence: true changed fictional Product HTML remains P1 human-only',()=>{
  const previousHtml='<html><script type="application/ld+json">{bad JSON}</script></html>'
  const newHtml='<html><script type="application/ld+json">{"@type":"Product","name":"Fake"}</script></html>'
  const prev=captured(inspectHtml(previousHtml).jsonLd)
  prev.html=inspectHtml(previousHtml)
  prev.manifestSha256=createHash('sha256').update(previousHtml).digest('hex')
  const next=candidate(inspectHtml(newHtml).jsonLd)
  next.html=inspectHtml(newHtml)
  next.manifestSha256=createHash('sha256').update(newHtml).digest('hex')
  const comparison=compareInspections({sourceCount:1,sources:[next]},
    {sourceCount:1,sources:[prev]})
  assert.equal(comparison.changes[0].status,'shape_changed')
  const q=buildOfflineSelectorReviewQueue(comparison)
  assert.equal(q.actions[0].priority,'P1')
  assert.equal(q.actions[0].productionEnabled,false)
  assert.equal(q.m5Eligible,false)
})

test('M5 candidate evidence: tampered observation missing parsed HTML fails before queue',()=>{
  const bogus=candidate([])
  assert.throws(()=>compareInspections({sourceCount:1,sources:[bogus]},
    {sourceCount:1,sources:[captured([])]}),ERROR)
})
