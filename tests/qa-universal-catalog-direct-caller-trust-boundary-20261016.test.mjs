import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Expected-RED independent QA for exported programmatic JS boundary.
// No live sources and no actual public price, credential, or consumer exploit.
const untrusted = /untrusted|reviewed|Only bounded|invalid|accessor|Proxy|refus/i

test('authentic six archived M1 source records remain accepted privately (positive control)', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.equal(catalog.sourceCount, 6)
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  for (const product of catalog.products) assert.equal(product.currentTrustedPriceCents, null)
})

test('direct catalog root Proxy must refuse before caller traps [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let traps = 0
  const input = new Proxy(batch, {
    get(target, name, receiver) {
      traps++
      return Reflect.get(target, name, receiver)
    },
    getOwnPropertyDescriptor(target, key) {
      traps++
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  assert.throws(() => buildUniversalRetailerCatalog(input), untrusted)
  assert.equal(traps, 0, 'never execute caller Proxy traps')
})

test('direct catalog must not execute inherited/accessor summary approval property [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let calls = 0
  Object.defineProperty(batch.summary, 'mode', {
    enumerable: true,
    configurable: true,
    get() {
      calls++
      return 'reviewed-offline-only'
    },
  })
  assert.throws(() => buildUniversalRetailerCatalog(batch), untrusted)
  assert.equal(calls, 0, 'do not inspect accessor to admit reviewed mode')
})

test('direct catalog must refuse forged nested observation price getter without executing it [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let calls = 0
  const original = batch.results[0].observations[0].currentPriceCents
  Object.defineProperty(batch.results[0].observations[0], 'currentPriceCents', {
    enumerable: true,
    configurable: true,
    get() {
      calls++
      return original
    },
  })
  assert.throws(() => buildUniversalRetailerCatalog(batch), untrusted)
  assert.equal(calls, 0, 'do not run dynamic JS to establish a price fact')
})

test('direct catalog must refuse attacker-chosen provenance URL getter before evaluating it [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let calls = 0
  const evidence = batch.results[0].observations[0].provenance
  const original = evidence.url
  Object.defineProperty(evidence, 'url', {
    enumerable: true,
    configurable: true,
    get() {
      calls++
      return original
    },
  })
  assert.throws(() => buildUniversalRetailerCatalog(batch), untrusted)
  assert.equal(calls, 0, 'a runtime getter must not serve as immutable source provenance')
})

test('revoked programmatic catalog Proxy must refuse cleanly without leaked native TypeError [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const { proxy, revoke } = Proxy.revocable(batch, {
    get() { throw new Error('unexpected caller trap execution') },
  })
  revoke()
  assert.throws(
    () => buildUniversalRetailerCatalog(proxy),
    error => !(error instanceof TypeError) && untrusted.test(String(error)),
    'reject revoked Proxy with catalog-level domain error, not a leaked engine TypeError',
  )
})

test('nested pack-data Proxy cannot execute descriptor/get traps during catalog assembly [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let traps = 0
  const item = batch.results[0].observations[0]
  item.pack = new Proxy(item.pack, {
    get(target, name, receiver) {
      traps++
      return Reflect.get(target, name, receiver)
    },
    getOwnPropertyDescriptor(target, name) {
      traps++
      return Reflect.getOwnPropertyDescriptor(target, name)
    },
  })
  assert.throws(() => buildUniversalRetailerCatalog(batch), untrusted)
  assert.equal(traps, 0, 'pack parsing must not execute arbitrary caller Proxy')
})
