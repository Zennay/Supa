import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Own-data HTML envelope + app-json descriptor QA, fake memory-only inputs.
const product = { type: ['Product'], keys: ['@type', 'name'] }
const html = () => ({
  hasNextData: false, jsonLd: [product], applicationJsonScripts: [],
})
function source(value = html(), parser = 'observation') {
  return {
    id: 'private-fictional-source', supermarket: 'plus', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: 'a'.repeat(64),
    html: value,
    schemaOrgProduct: parser === 'observation'
      ? { type: 'observation', observation: { hidden: 'SECRET-PRODUCT' } }
      : { type: 'abstain' },
  }
}
function invalid(x) {
  assert.throws(() => captureShape(x), err =>
    err instanceof Error && err.message === 'Invalid or unbounded inspected HTML shape' &&
    !err.message.includes('private-fictional-source') &&
    !err.message.includes('SECRET-PRODUCT'))
}
function notRead(make) {
  let calls = 0
  const getter = () => { calls++; throw new Error('SECRET-PRODUCT') }
  invalid(make(getter))
  assert.equal(calls, 0)
}
function queue(x, priority) {
  const q = buildOfflineSelectorReviewQueue(
    compareInspections({ sourceCount: 1, sources: [x] }))
  assert.equal(q.actions[0].priority, priority)
  assert.match(q.actions[0].sourceToken, /^[0-9a-f]{64}$/)
  for (const flag of ['rightsVerified','selectorVerified','productionReady','m5Eligible']) {
    assert.equal(q[flag], false)
  }
  for (const flag of ['rightsVerified','selectorVerified','productionEnabled']) {
    assert.equal(q.actions[0][flag], false)
  }
  assert.doesNotMatch(JSON.stringify(q), /private-fictional-source|SECRET-PRODUCT/)
}
test('envelope control: canonical Product source remains manual P2', () => {
  const x = source()
  assert.equal(captureShape(x).schemaOrgStatus, 'candidate_observation')
  queue(x, 'P2')
})
test('envelope control: canonical empty abstain remains P2', () => {
  queue(source({ hasNextData: false, jsonLd: [], applicationJsonScripts: [] }, 'abstain'), 'P2')
})
test('envelope control: canonical failed M1 remains P1 without HTML', () => {
  const x = source()
  x.success = false
  delete x.schemaOrgProduct
  delete x.html
  queue(x, 'P1')
})
test('envelope control: proper application-json summary bytes remain bounded', () => {
  const x = source({ hasNextData:false, jsonLd:[product],
    applicationJsonScripts:[{ id:null, bytes:1024 }] })
  assert.equal(captureShape(x).schemaOrgStatus, 'candidate_observation')
  queue(x, 'P2')
})
test('envelope RED: source html getter never executes', () => {
  notRead(get => {
    const x = source()
    Object.defineProperty(x,'html',{ get, enumerable:true })
    return x
  })
})
test('envelope RED: inherited source html cannot replace own inspection', () => {
  const x = source()
  const h = x.html
  delete x.html
  Object.setPrototypeOf(x, { html:h })
  invalid(x)
})
test('envelope RED: hasNextData getter never executes', () => {
  notRead(get => {
    const h = html()
    Object.defineProperty(h,'hasNextData',{ get, enumerable:true })
    return source(h)
  })
})
test('envelope RED: inherited hasNextData is not canonical M1 data', () => {
  const h = html()
  delete h.hasNextData
  Object.setPrototypeOf(h,{ hasNextData:false })
  invalid(source(h))
})
test('envelope RED: JSON-LD list getter never executes', () => {
  notRead(get => {
    const h = html()
    Object.defineProperty(h,'jsonLd',{ get, enumerable:true })
    return source(h)
  })
})
test('envelope RED: inherited JSON-LD list is not canonical M1 data', () => {
  const h = html()
  delete h.jsonLd
  Object.setPrototypeOf(h, { jsonLd:[product] })
  invalid(source(h))
})
test('envelope RED: application-json list getter never executes', () => {
  notRead(get => {
    const h = html()
    Object.defineProperty(h,'applicationJsonScripts',{ get, enumerable:true })
    return source(h)
  })
})
test('envelope RED: inherited application-json list is not canonical M1 data', () => {
  const h = html()
  delete h.applicationJsonScripts
  Object.setPrototypeOf(h, { applicationJsonScripts:[] })
  invalid(source(h))
})
test('envelope RED: app-json array index accessor never executes', () => {
  notRead(get => {
    const h = html()
    h.applicationJsonScripts = [{id:null,bytes:10}]
    Object.defineProperty(h.applicationJsonScripts,0,{ get, enumerable:true, configurable:true })
    return source(h)
  })
})
test('envelope RED: app-json id getter never executes', () => {
  notRead(get => {
    const h = html()
    const item = { bytes:10 }
    Object.defineProperty(item,'id',{ get, enumerable:true })
    h.applicationJsonScripts = [item]
    return source(h)
  })
})
test('envelope RED: app-json bytes getter never executes', () => {
  notRead(get => {
    const h = html()
    const item = { id:null }
    Object.defineProperty(item,'bytes',{ get, enumerable:true })
    h.applicationJsonScripts = [item]
    return source(h)
  })
})
