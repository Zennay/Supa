import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  main,
  pinInertPrivateCatalogInput,
  reviewInertPrivateCatalogInput,
} from '../scripts/qa-universal-catalog-inert-preflight.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

const denied = /Private universal catalog QA input refused/
const archived = () => loadReviewedRepositoryFixtures()

test('all six historical PLUS/Deka source kinds produce only private aggregate counts', async () => {
  const batch = await archived()
  const original = structuredClone(batch)
  const report = reviewInertPrivateCatalogInput(batch)
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.equal(report.mode, 'private-inert-universal-catalog-qa')
  assert.equal(report.sources, 6)
  assert.equal(report.products, catalog.productCount)
  assert.equal(report.captures, catalog.captureCount)
  assert.equal(report.conflictingProducts, catalog.conflictCount)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
  assert.equal(report.historicalOnly, true)
  assert.equal(Object.keys(report).some(key => /priceCents|name|sourceUrl|sha/i.test(key)), false)
  assert.doesNotMatch(JSON.stringify(report), /https?:\/\/|sourceProductId|offerPriceCents|snapshotSha256/)
  assert.deepEqual(batch, original, 'source batch must never be modified')
  assert.ok(Object.isFrozen(report))
})

test('inert snapshot detaches and freezes nested observation, provenance and package', async () => {
  const batch = await archived()
  const snapshot = pinInertPrivateCatalogInput(batch)
  const before = snapshot.results[0].observations[0].currentPriceCents
  const sha = snapshot.results[0].observations[0].provenance.sha256
  batch.results[0].observations[0].currentPriceCents = (before ?? 0) + 200
  batch.results[0].observations[0].provenance.sha256 = 'b'.repeat(64)
  assert.equal(snapshot.results[0].observations[0].currentPriceCents, before)
  assert.equal(snapshot.results[0].observations[0].provenance.sha256, sha)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.results))
  assert.ok(Object.isFrozen(snapshot.results[0].observations[0].pack))
  assert.ok(Object.isFrozen(snapshot.results[0].observations[0].provenance))
  assert.throws(() => { snapshot.results[0].observations[0].currentPriceCents = 1 }, TypeError)
})

test('repeated inert references detach independently, while actual cycles still refuse', () => {
  const shared = { id: 'offline-source', value: 1 }
  const copied = pinInertPrivateCatalogInput({ first: shared, second: shared })
  assert.deepEqual(copied.first, copied.second)
  assert.notEqual(copied.first, copied.second, 'shared input references must not stay shared in the pinned result')
  assert.ok(Object.isFrozen(copied.first))
  const cyclic = { value: 2 }
  cyclic.self = cyclic
  assert.throws(() => pinInertPrivateCatalogInput(cyclic), denied)
})

test('top-level caller Proxy and revoked Proxy refuse before executing any caller traps', async () => {
  const batch = await archived()
  let calls = 0
  const proxied = new Proxy(batch, {
    get() { calls++; throw new Error('should not execute root trap') },
    getOwnPropertyDescriptor() { calls++; throw new Error('should not execute root trap') },
  })
  assert.throws(() => reviewInertPrivateCatalogInput(proxied), denied)
  assert.equal(calls, 0)
  const revocable = Proxy.revocable(batch, { ownKeys() { calls++; throw new Error('never') } })
  revocable.revoke()
  assert.throws(() => reviewInertPrivateCatalogInput(revocable.proxy), denied)
  assert.equal(calls, 0)
})

test('nested late source field getters and price/provenance getters refuse before execution', async () => {
  const sample = await archived()
  for (const [label, change] of [
    ['late-source-observations', x => x.results[5]],
    ['summary-mode', x => x.summary],
    ['observation-money', x => x.results[0].observations[0]],
    ['provenance-url', x => x.results[0].observations[0].provenance],
    ['nested-offer', x => x.results.find(row => row.key.endsWith(':offers')).observations[0].offer],
  ]) {
    const batch = structuredClone(sample)
    const target = change(batch)
    assert.ok(target, label)
    const field = label === 'late-source-observations' ? 'observations'
      : label === 'summary-mode' ? 'mode'
        : label === 'observation-money' ? 'currentPriceCents'
          : label === 'provenance-url' ? 'url' : 'offerPriceCents'
    let calls = 0
    Object.defineProperty(target, field, {
      enumerable: true,
      configurable: true,
      get() { calls++; throw new Error('hostile-' + label) },
    })
    assert.throws(() => reviewInertPrivateCatalogInput(batch), denied, label)
    assert.equal(calls, 0, label)
  }
})

test('symbol, exotic prototype, inherited source, cyclic graph and sparse array are refused', async () => {
  const sample = await archived()
  for (const mutation of [
    b => { b[Symbol('identity')] = 'unsafe' },
    b => { Object.setPrototypeOf(b.summary, { mode: 'reviewed-offline-only' }) },
    b => { b.summary = Object.create({ mode: 'reviewed-offline-only' }) },
    b => { b.loop = b },
    b => { delete b.results[5] },
    b => { Object.defineProperty(b.summary, 'private', { value: true, enumerable: false }) },
    b => { b.results = new Proxy(b.results, { get() { throw new Error('array trap') } }) },
  ]) {
    const batch = structuredClone(sample)
    mutation(batch)
    assert.throws(() => reviewInertPrivateCatalogInput(batch), denied)
  }
})

test('deep nesting, oversize arrays, non-finite cents and undefined refuse without execution', async () => {
  for (const unsafe of [
    { a: new Array(16385).fill(0) },
    { a: Number.POSITIVE_INFINITY },
    { a: undefined },
    { a: (() => {}) },
  ]) assert.throws(() => pinInertPrivateCatalogInput(unsafe), denied)
  let nested = {}
  for (let i = 0; i < 36; i++) nested = { deeper: nested }
  assert.throws(() => pinInertPrivateCatalogInput(nested), denied)
})

test('exact raw six-source private CLI cannot be converted into external fetch or rights proof', async () => {
  const written = []
  const direct = await main([], line => written.push(line))
  assert.deepEqual(JSON.parse(written.join('')), direct)
  await assert.rejects(() => main(['--url', 'https://example.test'], () => {}), denied)
  let proxyCalls = 0
  const proxiedArgs = new Proxy([], { get() { proxyCalls++; throw new Error('CLI trap') } })
  await assert.rejects(() => main(proxiedArgs, () => {}), denied)
  assert.equal(proxyCalls, 0)
  const cli = new URL('../scripts/qa-universal-catalog-inert-preflight.mjs', import.meta.url).pathname
  const result = spawnSync(process.execPath, ['--experimental-strip-types', cli], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 8192,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), direct)
  assert.doesNotMatch(result.stdout, /https?:\/\/|halfvolle|priceCents|sourceProductId|sourceUrl/)
})
