import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'
import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// Every HTML fragment is invented; no live requests or retailer information.
const ERROR = /^Error: Invalid inspected Schema.org parse result$/
const provenance = {
  supermarket: 'fictional-store', kind: 'product', url: 'https://example.invalid/fake',
  capturedAt: '2026-10-14T00:00:00Z', sha256: 'a'.repeat(64),
}
function inspected(html, parserResult) {
  const source = {
    id: 'fake-source', supermarket: 'fictional-store', kind: 'product',
    success: true, integrity: 'verified',
    manifestSha256: createHash('sha256').update(html).digest('hex'),
    html: inspectHtml(html),
    schemaOrgProduct: parserResult,
  }
  return source
}
const script = (obj) => '<script type="application/ld+json">' + JSON.stringify(obj) + '</script>'
const candidate = (obj) => {
  const html = '<html>' + script(obj) + '</html>'
  return inspected(html, {type:'observation', observation: {name:'private-fictional'}})
}
function mustReject(source) {
  const copy = structuredClone(source)
  assert.throws(() => captureShape(source), ERROR)
  assert.deepEqual(source, copy)
}
const product = { '@type': 'Product', name: 'Fake', offers: { '@type': 'Offer',
  price: '2.00', priceCurrency: 'EUR' } }

test('M5 only a WebPage can never support an invented Product observation', () => {
  mustReject(candidate({'@type':'WebPage', name:'private-web-page'}))
})
test('M5 only an Offer can never support an invented Product observation', () => {
  mustReject(candidate({'@type':'Offer', name:'private-offer'}))
})
test('M5 only an ItemList can never support an invented Product observation', () => {
  mustReject(candidate({'@type':'ItemList', name:'private-list'}))
})
test('M5 multiple unrelated successfully parsed scripts still cannot stand in for a Product', () => {
  const fake = '<html>' + script({'@type':'WebPage'}) + script({'@type':'Offer'}) + '</html>'
  mustReject(inspected(fake, {type:'observation',observation:{name:'private'}}))
})
test('M5 accepts a Product after unrelated valid HTML scripts', () => {
  const fake = '<html>' + script({'@type':'WebPage'}) + script(product) + '</html>'
  assert.equal(captureShape(inspected(fake, {type:'observation',observation:{name:'private'}}))
    .schemaOrgStatus, 'candidate_observation')
})
test('M5 genuine direct Product from M1 parser stays a manual-only candidate', () => {
  const realM1 = parseSchemaOrgProduct(product, provenance)
  assert.equal(realM1.type, 'observation')
  const source = candidate(product)
  source.schemaOrgProduct = realM1
  const shape = captureShape(source)
  assert.equal(shape.schemaOrgStatus, 'candidate_observation')
  assert.equal(Object.hasOwn(shape, 'observation'), false)
  const comparison = compareInspections({sourceCount:1,sources:[source]},
    {sourceCount:1,sources:[structuredClone(source)]})
  const queue = buildOfflineSelectorReviewQueue(comparison)
  assert.equal(queue.actions[0].priority,'P3')
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
  assert.equal(queue.rightsVerified,false)
  assert.doesNotMatch(JSON.stringify(queue), /Fake|private-fictional|fake-source|fictional-store/)
})
test('M5 Product type matching is case-insensitive like canonical M1', () => {
  const lower = {...product, '@type':'pRoDuCt'}
  assert.equal(parseSchemaOrgProduct(lower, provenance).type,'observation')
  assert.equal(captureShape(candidate(lower)).schemaOrgStatus,'candidate_observation')
})
test('M5 type arrays containing a Product are valid', () => {
  const multi = {...product, '@type':['WebPage','Product']}
  assert.equal(parseSchemaOrgProduct(multi, provenance).type,'observation')
  assert.equal(captureShape(candidate(multi)).schemaOrgStatus,'candidate_observation')
})
test('M5 nested @graph Product is still valid and eligible for human P2 only', () => {
  const graph = {'@context':'https://schema.org','@graph':[product]}
  assert.equal(parseSchemaOrgProduct(graph, provenance).type,'observation')
  const queue = buildOfflineSelectorReviewQueue(compareInspections(
    {sourceCount:1,sources:[candidate(graph)]}))
  assert.equal(queue.actions[0].priority,'P2')
  assert.equal(queue.actions[0].selectorVerified,false)
  assert.equal(queue.m5Eligible,false)
})
test('M5 @graph can contain WebPage plus a Product without flattening types', () => {
  const graph = {'@graph':[{'@type':'WebPage'},product]}
  assert.equal(parseSchemaOrgProduct(graph,provenance).type,'observation')
  assert.equal(captureShape(candidate(graph)).schemaOrgStatus,'candidate_observation')
})
test('M5 canonical real M1 WebPage abstention remains valid for P3', () => {
  const obj={'@type':'WebPage',name:'fake'}
  const parsed=parseSchemaOrgProduct(obj,provenance)
  assert.equal(parsed.type,'abstain')
  const source=inspected('<html>'+script(obj)+'</html>',parsed)
  const queue=buildOfflineSelectorReviewQueue(compareInspections(
    {sourceCount:1,sources:[source]},{sourceCount:1,sources:[structuredClone(source)]}))
  assert.equal(queue.actions[0].priority,'P3')
  assert.equal(queue.actions[0].status,'unchanged')
  assert.equal(queue.m5Eligible,false)
})
test('M5 parser errors cannot be substituted for Product evidence', () => {
  const html='<html><script type="application/ld+json">{invalid</script>'+script({'@type':'WebPage'})+'</html>'
  mustReject(inspected(html, {type:'observation',observation:{name:'private'}}))
})
test('M5 real Product drift from earlier WebPage stays P1 and never permits automatic release', () => {
  const earlier={'@type':'WebPage',name:'Fake'}
  const prev=inspected('<html>'+script(earlier)+'</html>',parseSchemaOrgProduct(earlier,provenance))
  const next=candidate(product)
  const queue=buildOfflineSelectorReviewQueue(compareInspections(
    {sourceCount:1,sources:[next]},{sourceCount:1,sources:[prev]}))
  assert.equal(queue.actions[0].priority,'P1')
  assert.equal(queue.selectorVerified,false)
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
})
test('M5 an unavailable source has no Schema.org signal but still remains unavailable', () => {
  const unavailable={ id:'fake-source',supermarket:'fictional-store',kind:'product',success:false }
  assert.equal(captureShape(unavailable).captureStatus,'unavailable')
  const queue=buildOfflineSelectorReviewQueue(compareInspections(
    {sourceCount:1,sources:[unavailable]}))
  assert.equal(queue.actions[0].priority,'P1')
  assert.equal(queue.m5Eligible,false)
})
