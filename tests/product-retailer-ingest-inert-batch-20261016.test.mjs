import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  ingestReviewedEvidence, ingestReviewedBatch, RETAILER_REVIEWED_FIXTURES, main,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Uses the original six checked M1 fixture bytes only. Malicious fields are
// counterfactual in-memory JS callers; no HTTP, live prices or source rights.
const evidence = async () => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + RETAILER_REVIEWED_FIXTURES[0], import.meta.url),
  'utf8',
))
const refused = /Untrusted reviewed source object/

test('real immutable historical PLUS product survives strict adapter dispatch unchanged', async () => {
  const item = await evidence()
  const before = structuredClone(item)
  const result = ingestReviewedEvidence(item)
  assert.equal(result.accepted, true)
  assert.ok(result.observations.length > 0)
  assert.deepEqual(item, before)
  assert.equal(result.observations[0].provenance.sha256, item.source.sha256)
  const batch = ingestReviewedBatch([item])
  assert.equal(batch.summary.sources, 1)
  assert.equal(batch.summary.acceptedSources, 1)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
})

test('root, source, and nested JS getters never run before their trust boundary', async () => {
  for (const position of ['root','source','nested']) {
    const item = await evidence()
    let getterCalls = 0
    const target = position === 'root' ? item : position === 'source'
      ? item.source : item.browserEvidence.safety
    const field = position === 'root' ? 'source' : position === 'source'
      ? 'supermarket' : 'antiBotBypass'
    const original = target[field]
    Object.defineProperty(target,field,{
      enumerable:true,configurable:true,
      get(){ getterCalls++; return original },
    })
    assert.throws(() => ingestReviewedEvidence(item),refused,position)
    assert.equal(getterCalls,0,position)
  }
})

test('root/source/nested Proxies and revoked Proxy never execute caller traps', async () => {
  for (const position of ['root','source','nested']) {
    const item = await evidence()
    let calls = 0
    const target = position === 'root' ? item : position === 'source'
      ? item.source : item.browserEvidence.safety
    const wrapped = new Proxy(target,{
      get(t,key){calls++;return Reflect.get(t,key)},
      ownKeys(t){calls++;return Reflect.ownKeys(t)},
      getOwnPropertyDescriptor(t,key){calls++;return Reflect.getOwnPropertyDescriptor(t,key)},
    })
    if (position === 'root') assert.throws(() => ingestReviewedEvidence(wrapped),refused)
    else if (position === 'source') {
      item.source = wrapped
      assert.throws(() => ingestReviewedEvidence(item),refused)
    } else {
      item.browserEvidence.safety = wrapped
      assert.throws(() => ingestReviewedEvidence(item),refused)
    }
    assert.equal(calls,0,position)
  }
  const item = await evidence()
  const {proxy,revoke} = Proxy.revocable(item.source,{get(){throw new Error('get trap executed')}})
  revoke()
  item.source = proxy
  assert.throws(() => ingestReviewedEvidence(item),refused)
})

test('inherited identity and symbols cannot become source provenance', async () => {
  const item = await evidence()
  const prototype = { supermarket:item.source.supermarket }
  delete item.source.supermarket
  Object.setPrototypeOf(item.source,prototype)
  assert.throws(() => ingestReviewedEvidence(item),refused)
  const symbolized = await evidence()
  symbolized.source[Symbol('alternate retailer')] = 'plus'
  assert.throws(() => ingestReviewedEvidence(symbolized),refused)
})

test('batch array proxy, index accessor, inherited/extra fields, sparse slots never execute', async () => {
  const item = await evidence()
  let calls = 0
  const proxy = new Proxy([item],{
    get(t,key){calls++;return Reflect.get(t,key)},
    ownKeys(t){calls++;return Reflect.ownKeys(t)},
    getOwnPropertyDescriptor(t,key){calls++;return Reflect.getOwnPropertyDescriptor(t,key)},
  })
  assert.throws(() => ingestReviewedBatch(proxy),/Reviewed batch/)
  assert.equal(calls,0)
  const getterArray = [item]
  Object.defineProperty(getterArray,0,{
    enumerable:true,configurable:true,
    get(){calls++;return item},
  })
  assert.throws(() => ingestReviewedBatch(getterArray),refused)
  assert.equal(calls,0)
  const sparse = [item,item]
  delete sparse[1]
  assert.throws(() => ingestReviewedBatch(sparse),/Reviewed batch|Untrusted/)
  const symbolic = [item]
  symbolic[Symbol('hidden')] = 'unsafe'
  assert.throws(() => ingestReviewedBatch(symbolic),/Reviewed batch/)
})

test('malicious nested arrays and cyclic/hugely deep evidence refuse without caller mutation', async () => {
  const source = await evidence()
  const nested = structuredClone(source)
  // One documented source data field is replaced with a hostile array;
  // structural rejection happens before any adapter can parse it.
  nested.browserEvidence.safety = Array.from({length:16385},()=>null)
  assert.throws(() => ingestReviewedEvidence(nested),refused)
  const cyclic = await evidence()
  cyclic.browserEvidence.safety.self = cyclic
  assert.throws(() => ingestReviewedEvidence(cyclic),refused)
  const other = await evidence()
  const batch = [other,structuredClone(other)]
  assert.throws(() => ingestReviewedBatch(batch),/Duplicate reviewed capture identity/)
  assert.equal(batch.length,2)
})

test('offline ingest CLI refuses Proxy, foreign and accessor argv with no fixture reads', async () => {
  let calls=0
  const proxy = new Proxy([], {
    get(t,k){calls++;return Reflect.get(t,k)},
    ownKeys(t){calls++;return Reflect.ownKeys(t)},
  })
  let output=''
  await assert.rejects(main(proxy,x=>{output+=x}),/Usage:/)
  assert.equal(calls,0)
  assert.equal(output,'')
  const alien = Object.assign(Object.create(null),{length:0})
  await assert.rejects(main(alien),/Usage:/)
  const extra = []
  extra[Symbol('hidden')] = 'wrong'
  await assert.rejects(main(extra),/Usage:/)
  const accepted = await main([],x=>{output+=x})
  assert.equal(accepted.permissionVerified,false)
  assert.equal(accepted.productionEnabled,false)
  assert.equal(accepted.acceptedSources,6)
  assert.doesNotMatch(output,/currentPriceCents|sourceProductId|https?:\/\//)
})

test('whole-batch source preflight rejects later malicious capture without getter execution', async () => {
  const first = await evidence()
  const second = structuredClone(first)
  second.source.id += '-later'
  let calls = 0
  const realValue = second.source.id
  Object.defineProperty(second.source, 'id', {
    enumerable: true, configurable: true,
    get(){calls++;return realValue},
  })
  const unchanged = structuredClone(first)
  assert.throws(() => ingestReviewedBatch([first,second]), refused)
  assert.equal(calls,0)
  assert.deepEqual(first, unchanged)
})

test('whole-batch detects exact duplicate reviewed source before returning any results', async () => {
  const actual = await evidence()
  const duplicate = structuredClone(actual)
  assert.throws(
    () => ingestReviewedBatch([actual,duplicate]),
    /Duplicate reviewed capture identity/,
  )
})

test('validated observations are editable private output copies without mutating pinned inputs', async () => {
  const item = await evidence()
  const before = structuredClone(item)
  const accepted = ingestReviewedEvidence(item)
  assert.equal(accepted.accepted,true)
  assert.ok(accepted.observations.length > 0)
  const observed = accepted.observations[0]
  const originalClock = observed.provenance.capturedAt
  const originalUrl = observed.provenance.url
  observed.provenance.capturedAt = '2025-01-01T00:00:00.000Z'
  observed.provenance.url = 'https://offline.example.test/fake'
  assert.deepEqual(item,before)
  const again = ingestReviewedEvidence(item)
  assert.equal(again.observations[0].provenance.capturedAt, originalClock)
  assert.equal(again.observations[0].provenance.url, originalUrl)
  assert.equal(again.accepted,true)
})

test('batch output provenance edits cannot leak back to other offline ingestion runs', async () => {
  const item = await evidence()
  const first = ingestReviewedBatch([item])
  const copy = ingestReviewedBatch([item])
  first.results[0].observations[0].provenance.url = 'https://offline.example.test/changed'
  assert.equal(copy.results[0].observations[0].provenance.url, item.source.url)
  assert.equal(copy.summary.productionEnabled,false)
  assert.equal(copy.summary.permissionVerified,false)
  assert.equal(copy.summary.publicSavingsClaimEligible,false)
})
