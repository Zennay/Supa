import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Entirely fictional in-memory M1 inspected capture records; no retail HTTP.
const ERROR = /^Error: Invalid inspected Schema.org parse result$/
const makeSource = (overrides = {}) => ({
  id: 'fictional-source', supermarket: 'fictional-market', kind: 'product',
  success: true, integrity: 'verified', manifestSha256: 'a'.repeat(64),
  html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
  schemaOrgProduct: { type: 'abstain', reasons: [] }, ...overrides,
})
const compareOne = (current, baseline) => compareInspections(
  { sourceCount: 1, sources: [current] },
  { sourceCount: 1, sources: [baseline] },
)
function refuse(source) {
  const before = structuredClone(source)
  assert.throws(() => captureShape(source), ERROR)
  assert.deepEqual(source, before)
}

test('M5 Schema.org provenance: successful M1 capture must have an own parser result', () => {
  const source = makeSource()
  delete source.schemaOrgProduct
  refuse(source)
})

test('M5 Schema.org provenance: null/scalar/array parser records are rejected', () => {
  for (const value of [null, false, true, 0, 1, '', 'abstain', [], ['observation']]) {
    refuse(makeSource({ schemaOrgProduct: value }))
  }
})

test('M5 Schema.org provenance: object parser outcome needs own recognized type', () => {
  for (const value of [{}, {type:null}, {type:false}, {type:'unknown'},
    {type:'verified'}, {type:'candidate_observation'}, {type:[]}, {type:0}]) {
    refuse(makeSource({schemaOrgProduct:value}))
  }
})

test('M5 Schema.org provenance: inherited parser records cannot masquerade as own', () => {
  const source=makeSource()
  delete source.schemaOrgProduct
  Object.setPrototypeOf(source,{ schemaOrgProduct: {type:'abstain'} })
  assert.throws(()=>captureShape(source),ERROR)
})

test('M5 Schema.org provenance: inherited decision type cannot masquerade as canonical', () => {
  const source=makeSource({
    schemaOrgProduct: Object.create({ type: 'abstain' }),
  })
  assert.throws(()=>captureShape(source),ERROR)
})

test('M5 Schema.org provenance: accessor-derived parser decision is not evaluated', () => {
  let called=0
  const decision={}
  Object.defineProperty(decision,'type',{ enumerable:true,
    get(){called+=1;throw Error('private-getter-source-label')},
  })
  const source=makeSource({schemaOrgProduct:decision})
  assert.throws(()=>captureShape(source),ERROR)
  assert.equal(called,0)
})

test('M5 Schema.org provenance: accessor-derived source parser result is not evaluated', () => {
  let called=0
  const source=makeSource()
  Object.defineProperty(source,'schemaOrgProduct',{enumerable:true,
    get(){called+=1;throw Error('private-source-path')},
  })
  assert.throws(()=>captureShape(source),ERROR)
  assert.equal(called,0)
})

test('M5 Schema.org provenance: explicit abstain remains valid and manual-only', () => {
  const input=makeSource()
  const before=structuredClone(input)
  const out=captureShape(input)
  assert.equal(out.schemaOrgStatus,'abstain')
  assert.equal(out.captureStatus,'verified')
  assert.deepEqual(input,before)
})

test('M5 Schema.org provenance: explicit observation remains a candidate, never approved', () => {
  const input=makeSource({
    html: { hasNextData:false, jsonLd:[{type:['Product'],keys:['@type','name']}],
      applicationJsonScripts:[] },
    schemaOrgProduct:{type:'observation',observation:{name:'Fictional'}}
  })
  const out=captureShape(input)
  assert.equal(out.schemaOrgStatus,'candidate_observation')
  assert.equal(out.captureStatus,'verified')
  assert.equal(Object.hasOwn(out,'observation'),false)
  assert.doesNotMatch(JSON.stringify(out),/Fictional/)
})

test('M5 Schema.org provenance: failed source cannot contain a forged positive parse result', () => {
  const input=makeSource({success:false,integrity:'not-applicable',html:null,
    schemaOrgProduct:{type:'observation',observation:{name:'Fictional'}}})
  refuse(input)
})

test('M5 Schema.org provenance: failed source cannot carry a forged abstain result', () => {
  const input=makeSource({success:false,integrity:'not-applicable',html:null,
    schemaOrgProduct:{type:'abstain',reasons:[]}})
  refuse(input)
})

test('M5 Schema.org provenance: actual failed M1 capture without parser decision remains unavailable', () => {
  const input=makeSource({success:false,integrity:'not-applicable',html:null})
  delete input.schemaOrgProduct
  const result=captureShape(input)
  assert.equal(result.captureStatus,'unavailable')
  assert.equal(result.schemaOrgStatus,'unknown')
})

test('M5 Schema.org provenance: missing parser decision cannot flow through comparison', () => {
  const current=makeSource()
  delete current.schemaOrgProduct
  assert.throws(()=>compareOne(current,makeSource()),ERROR)
})

test('M5 Schema.org provenance: real inspectHtml + SHA full M5 comparison retains P3', () => {
  const html='<html><script type="application/ld+json">{bad json}</script></html>'
  const rec=makeSource({
    manifestSha256:createHash('sha256').update(html).digest('hex'),
    html:inspectHtml(html),
  })
  const report=compareOne(rec,structuredClone(rec))
  assert.equal(report.changes[0].status,'unchanged')
  const out=buildOfflineSelectorReviewQueue(report)
  assert.equal(out.actions[0].priority,'P3')
  assert.equal(out.summary.statusCounts.unchanged,1)
  assert.equal(out.productionReady,false)
  assert.equal(out.m5Eligible,false)
})

test('M5 Schema.org provenance: legitimate changed HTML produces manual P1 only', () => {
  const oldHtml='<html><title>Old</title></html>'
  const newHtml='<html><script type="application/ld+json">{"@type":"Product","name":"Fake"}</script></html>'
  const captured=html=>makeSource({
    manifestSha256:createHash('sha256').update(html).digest('hex'),
    html:inspectHtml(html),
  })
  const report=compareOne(captured(newHtml),captured(oldHtml))
  assert.equal(report.changes[0].status,'shape_changed')
  const output=buildOfflineSelectorReviewQueue(report)
  assert.equal(output.actions[0].priority,'P1')
  assert.equal(output.actions[0].productionEnabled,false)
  assert.equal(output.m5Eligible,false)
})

test('M5 Schema.org provenance: malformed failed record cannot become a first-capture P1', () => {
  const source=makeSource({success:false,integrity:'not-applicable',html:null,
    schemaOrgProduct:{type:'observation'}})
  assert.throws(()=>compareInspections({sourceCount:1,sources:[source]}),ERROR)
})
