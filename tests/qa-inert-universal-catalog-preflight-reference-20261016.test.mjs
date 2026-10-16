import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  pinInertCatalogReference,
  buildQaCatalogWithInertReference,
} from './support/qa-inert-retailer-catalog-reference.mjs'

// This is proof-of-approach for product issue #3189, NOT a product patch.
// Native product buildUniversalRetailerCatalog remains unsafe on direct caller
// JS until owner integrates equivalent scrutiny and the original RED turn GREEN.
const refused = /Untrusted direct catalog JavaScript input/

async function source() { return loadReviewedRepositoryFixtures() }

test('real six archived PLUS/Deka sources remain private and byte-stable through inert reference', async () => {
  const batch = await source()
  const before = structuredClone(batch)
  const frozen = pinInertCatalogReference(batch)
  assert.equal(Object.isFrozen(frozen), true)
  assert.equal(Object.isFrozen(frozen.results[0].observations[0].provenance), true)
  assert.deepEqual(frozen, batch)
  const actual = buildQaCatalogWithInertReference(batch)
  assert.equal(actual.sourceCount, 6)
  assert.ok(actual.productCount > 0)
  assert.equal(actual.productionEnabled, false)
  assert.equal(actual.publicSavingsClaimEligible, false)
  for (const product of actual.products) {
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
  }
  assert.deepEqual(batch, before)
})

test('root Proxy refuses without calling get/descriptor traps', async () => {
  let traps = 0
  const input = new Proxy(await source(), {
    get(target, name, receiver) { traps++; return Reflect.get(target, name, receiver) },
    getOwnPropertyDescriptor(target, name) {
      traps++
      return Reflect.getOwnPropertyDescriptor(target, name)
    },
  })
  assert.throws(() => buildQaCatalogWithInertReference(input), refused)
  assert.equal(traps, 0)
})

test('summary getter and inherited summary scope cannot grant review authority', async () => {
  const b = await source()
  let calls = 0
  Object.defineProperty(b.summary, 'mode', {
    enumerable: true,
    configurable: true,
    get() { calls++; return 'reviewed-offline-only' },
  })
  assert.throws(() => buildQaCatalogWithInertReference(b), refused)
  assert.equal(calls, 0)

  const inherited = await source()
  const original = inherited.summary.mode
  delete inherited.summary.mode
  Object.setPrototypeOf(inherited.summary, { mode: original })
  assert.throws(() => buildQaCatalogWithInertReference(inherited), refused)
})

test('nested observation money/provenance/pack getters are refused before invocation', async () => {
  for (const path of [
    ['currentPriceCents'],
    ['provenance', 'url'],
    ['pack', 'rawText'],
  ]) {
    const b = await source()
    let target = b.results[0].observations[0]
    for (const key of path.slice(0, -1)) target = target[key]
    const key = path.at(-1)
    const previous = target[key]
    let called = 0
    Object.defineProperty(target, key, {
      enumerable: true, configurable: true,
      get() { called++; return previous },
    })
    assert.throws(() => buildQaCatalogWithInertReference(b), refused, path.join('.'))
    assert.equal(called, 0, path.join('.'))
  }
})

test('nested Proxy and revoked Proxy both refuse with controlled domain errors, never traps', async () => {
  const b = await source()
  let calls = 0
  b.results[0].observations[0].pack = new Proxy(b.results[0].observations[0].pack, {
    get(target, name) { calls++; return Reflect.get(target, name) },
    ownKeys(target) { calls++; return Reflect.ownKeys(target) },
  })
  assert.throws(() => buildQaCatalogWithInertReference(b), refused)
  assert.equal(calls, 0)
  const revocable = Proxy.revocable(await source(), {
    get() { throw new Error('caller trap executed') },
  })
  revocable.revoke()
  assert.throws(() => buildQaCatalogWithInertReference(revocable.proxy), refused)
})

test('sparse result arrays, getter slots, symbol fields and cycles fail before catalog evaluation', async () => {
  const b = await source()
  const sparse = structuredClone(b)
  delete sparse.results[0]
  assert.throws(() => buildQaCatalogWithInertReference(sparse), refused)

  const getter = structuredClone(b)
  let calls = 0
  Object.defineProperty(getter.results, '0', {
    enumerable: true, configurable: true, get() { calls++; return b.results[0] },
  })
  assert.throws(() => buildQaCatalogWithInertReference(getter), refused)
  assert.equal(calls, 0)

  const symbol = structuredClone(b)
  symbol.results[0][Symbol('false-source')] = 'not allowed'
  assert.throws(() => buildQaCatalogWithInertReference(symbol), refused)

  const cycle = structuredClone(b)
  cycle.extra = cycle
  assert.throws(() => buildQaCatalogWithInertReference(cycle), refused)
})

test('unsupported data types and excessive nesting cannot promote a retail fact', async () => {
  for (const untrusted of [
    () => {},
    Infinity,
    -Infinity,
    NaN,
    5n,
    new Date(),
    new Set(['plus']),
  ]) {
    const b = await source()
    b.extra = untrusted
    assert.throws(() => buildQaCatalogWithInertReference(b), refused)
  }
  const deep = await source()
  let branch = {}
  deep.extra = branch
  for (let i = 0; i < 45; i++) {
    branch.child = {}
    branch = branch.child
  }
  assert.throws(() => buildQaCatalogWithInertReference(deep), refused)
})

test('caller mutation after pinning cannot overwrite a catalog approval, SHA or price', async () => {
  const b = await source()
  const pinned = pinInertCatalogReference(b)
  const previous = pinned.results[0].observations[0]
  b.summary.productionEnabled = true
  b.results[0].observations[0].currentPriceCents = 1
  b.results[0].observations[0].provenance.sha256 = 'a'.repeat(64)
  assert.equal(pinned.summary.productionEnabled, false)
  assert.equal(pinned.results[0].observations[0].currentPriceCents, previous.currentPriceCents)
  assert.notEqual(pinned.results[0].observations[0].provenance.sha256, 'a'.repeat(64))
})
