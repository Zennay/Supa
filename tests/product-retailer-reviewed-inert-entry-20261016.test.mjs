import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { snapshotInertReviewedEvidence } from '../scripts/retailer-inert-json-admission.mjs'
import { ingestReviewedEvidence, ingestReviewedBatch } from '../scripts/retailer-reviewed-ingest-engine.mjs'

async function plusFixture() {
  return JSON.parse(await readFile(
    new URL('../fixtures/m1/plus-rendered-product-halfvolle-melk.v1.json', import.meta.url),
    'utf8'))
}

test('reviewed historical PLUS evidence still ingests without mutating originals or publishing a price', async () => {
  const original = await plusFixture()
  const frozenBytes = JSON.stringify(original)
  const result = ingestReviewedEvidence(original)
  assert.equal(result.key, 'plus:product')
  assert.equal(result.accepted, true)
  assert.ok(result.observations.length > 0)
  assert.equal(JSON.stringify(original), frozenBytes)
  const batch = ingestReviewedBatch([original])
  assert.equal(batch.summary.acceptedSources, 1)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
})

test('getters anywhere in a source tree are NEVER invoked by either entrypoint', async () => {
  const original = await plusFixture()
  let executions = 0
  const forbidden = () => { executions++; throw Error('GETTER MUST NEVER RUN') }
  const source = structuredClone(original)
  Object.defineProperty(source.source, 'supermarket', { enumerable: true, get: forbidden })
  assert.throws(() => ingestReviewedEvidence(source), /inert JSON/)
  assert.throws(() => ingestReviewedBatch([source]), /inert JSON/)
  assert.equal(executions, 0)
  const nested = structuredClone(original)
  Object.defineProperty(nested.browserEvidence, 'safety', {
    enumerable: true, get: forbidden,
  })
  assert.throws(() => ingestReviewedEvidence(nested), /inert JSON/)
  assert.throws(() => ingestReviewedBatch([nested]), /inert JSON/)
  assert.equal(executions, 0)
})

test('Proxy object and Proxy batch never run their traps', async () => {
  const original = await plusFixture()
  let accessed = 0
  const malicious = new Proxy(original, {
    get() { accessed++; throw Error('PROXY GET CALLED') },
    ownKeys() { accessed++; throw Error('PROXY OWNKEYS CALLED') },
    getPrototypeOf() { accessed++; throw Error('PROXY PROTOTYPE CALLED') },
  })
  assert.throws(() => ingestReviewedEvidence(malicious), /inert JSON/)
  assert.throws(() => ingestReviewedBatch([malicious]), /inert JSON/)
  assert.equal(accessed, 0)
  const batch = new Proxy([original], {
    get() { accessed++; throw Error('PROXY GET CALLED') },
    ownKeys() { accessed++; throw Error('PROXY OWNKEYS CALLED') },
  })
  assert.throws(() => ingestReviewedBatch(batch), /inert JSON/)
  assert.equal(accessed, 0)
})

test('nested exotic objects, accessor arrays, symbols, and functions fail closed', async () => {
  const original = await plusFixture()
  for (const invalid of [new Date(), new Map(), new Uint8Array([1]), () => 123, 1n]) {
    const altered = structuredClone(original)
    altered.browserEvidence.safety = invalid
    assert.throws(() => ingestReviewedEvidence(altered), /inert JSON/)
  }
  const accessorArray = [original]
  Object.defineProperty(accessorArray, '0', {
    enumerable: true, configurable: true, get: () => { throw Error('array getter invoked') },
  })
  assert.throws(() => ingestReviewedBatch(accessorArray), /inert JSON/)
  const symbol = structuredClone(original)
  symbol[Symbol('secret')] = true
  assert.throws(() => ingestReviewedEvidence(symbol), /inert JSON/)
})

test('sparse/oversized arrays, circular references, and overly deep evidence cannot enter the adapters', async () => {
  const original = await plusFixture()
  const sparse = new Array(2)
  sparse[1] = original
  assert.throws(() => ingestReviewedBatch(sparse), /inert JSON/)
  assert.throws(() => ingestReviewedBatch(new Array(65537)), /inert JSON/)
  const cyclic = structuredClone(original)
  cyclic.self = cyclic
  assert.throws(() => ingestReviewedEvidence(cyclic), /inert JSON/)
  const deep = structuredClone(original)
  let cursor = deep
  for (let i = 0; i < 70; i++) {
    cursor.extra = {}
    cursor = cursor.extra
  }
  assert.throws(() => ingestReviewedEvidence(deep), /inert JSON/)
})

test('snapshot is detached, keeps benign Unicode and own __proto__ as inert data', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"query":"courgette 🥒","values":[1,null,true]}')
  const snapshot = snapshotInertReviewedEvidence(source)
  source.values[0] = 100
  assert.equal(snapshot.values[0], 1)
  assert.equal(snapshot.query, 'courgette 🥒')
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype)
  assert.equal(Object.hasOwn(snapshot, '__proto__'), true)
  assert.equal({}.polluted, undefined)
  assert.deepEqual(snapshot.values, [1, null, true])
})

test('invalid number, overlong strings and a top-level primitive fail without retailer I/O', () => {
  assert.throws(() => snapshotInertReviewedEvidence({ price: Infinity }), /inert JSON/)
  assert.throws(() => snapshotInertReviewedEvidence({ price: NaN }), /inert JSON/)
  assert.throws(() => snapshotInertReviewedEvidence({ key: 'x'.repeat(1_048_577) }), /inert JSON/)
  assert.throws(() => ingestReviewedEvidence('https://www.plus.nl/'), /structured source record/)
})

test('a batch cannot amortize many individually valid strings into an unbounded UTF-8 payload', () => {
  // One shared input string keeps the test cheap while exercising aggregate accounting.
  const oneMegabyte = 'a'.repeat(1_000_000)
  const oversized = Array.from({ length: 34 }, () => oneMegabyte)
  assert.throws(() => snapshotInertReviewedEvidence(oversized), /inert JSON/)
  const acceptable = Array.from({ length: 2 }, () => 'gewone boodschappen')
  assert.deepEqual(snapshotInertReviewedEvidence(acceptable), acceptable)
})
