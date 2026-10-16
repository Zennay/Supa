import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { assessHistoricalM3FullBasketReadiness, main } from
  '../scripts/retailer-private-m3-full-basket-preflight.mjs'

const fail = /Private M3 offline full-basket preflight refused/
async function historical() { return structuredClone(await loadReviewedRepositoryFixtures()) }

test('six authentic archived PLUS/Deka captures compose with both canonical planner queues', async () => {
  const batch = await historical()
  const unchanged = structuredClone(batch)
  const result = assessHistoricalM3FullBasketReadiness(batch)
  assert.equal(result.sourceCount, 6)
  assert.equal(result.acceptedSourceCount, 6)
  assert.equal(result.sourceKinds.length, 6)
  assert.equal(result.canonicalPlannerNeeds, 11)
  assert.equal(result.twoStoreReviewRows, 22)
  assert.equal(result.manualSuggestions + result.unresolvedReviewRows, 22)
  assert.ok(result.observationCount >= 6)
  assert.ok(result.privateCatalogProducts > 0)
  assert.equal(result.privateCatalogCaptures, result.observationCount)
  assert.equal(result.releaseDecision, 'hold')
  assert.equal(result.fullBasketFieldComparisonVerified, false)
  assert.equal(result.actualRetailerPriceOrStockVerified, false)
  assert.equal(result.retailerReuseRightsVerified, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.externalRequests, 0)
  assert.deepEqual(batch, unchanged)
})

test('default zero-argument CLI produces aggregate-only deterministic private report', async () => {
  const output = []
  const report = await main([], line => output.push(line))
  assert.equal(output.length, 1)
  assert.deepEqual(JSON.parse(output[0]), report)
  assert.equal(report.canonicalPlannerNeeds, 11)
  assert.equal(report.twoStoreReviewRows, 22)
  assert.doesNotMatch(output[0],
    /https?:\/\/|sourceProductId|currentPriceCents|offerPriceCents|snapshotSha256|capturedAt|packAmount/)
})

test('complete six-shape coverage and declared permission denials are mandatory', async () => {
  const mutants = [
    b => { b.summary.productionEnabled = true },
    b => { b.summary.permissionVerified = true },
    b => { b.summary.publicSavingsClaimEligible = true },
    b => { b.summary.sources = 5 },
    b => { b.summary.acceptedSources = 5 },
    b => { b.summary.rejectedSources = 1 },
    b => { b.results.pop() },
    b => { b.results[0] = structuredClone(b.results[1]) },
    b => { b.results[0].accepted = false },
    b => { b.results[0].key = 'ah:product' },
    b => { b.results[0].observations[0].provenance.sha256 = 'broken' },
  ]
  for (const mutate of mutants) {
    const batch = await historical()
    mutate(batch)
    assert.throws(() => assessHistoricalM3FullBasketReadiness(batch), fail)
  }
})

test('reviewer reference clocks reject future originals and unsafe ages', async () => {
  const batch = await historical()
  assert.throws(() => assessHistoricalM3FullBasketReadiness(batch, {
    referenceTime: '2020-01-01T00:00:00Z',
  }), fail)
  for (const hours of [0, -1, 721, 1.5, '24']) {
    assert.throws(() => assessHistoricalM3FullBasketReadiness(batch, {
      maxAgeHours: hours,
    }), fail)
  }
})

test('caller objects and audit options are snapped before any getter or Proxy trap executes', async () => {
  const batch = await historical()
  let traps = 0
  const trip = () => { traps++; throw new Error('caller code executed') }
  const proxy = new Proxy(batch, { get: trip, ownKeys: trip })
  assert.throws(() => assessHistoricalM3FullBasketReadiness(proxy), fail)
  const options = {}
  Object.defineProperty(options, 'referenceTime', {
    enumerable: true, get: trip,
  })
  assert.throws(() => assessHistoricalM3FullBasketReadiness(batch, options), fail)
  const revoked = Proxy.revocable({ referenceTime: '2026-10-16T00:00:00Z' }, {})
  revoked.revoke()
  assert.throws(() => assessHistoricalM3FullBasketReadiness(batch, revoked.proxy), e =>
    !(e instanceof TypeError) && fail.test(String(e)))
  assert.equal(traps, 0)
})

test('invalid exported CLI flags and spoofed argv never emit product evidence', async () => {
  let output = ''
  const write = text => { output += text }
  const proxy = new Proxy(['--publish'], {
    get() { throw Error('caller argv trap') },
  })
  await assert.rejects(main(proxy, write), fail)
  await assert.rejects(main(['--publish'], write), fail)
  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  await assert.rejects(main(revoked.proxy, write), e =>
    !(e instanceof TypeError) && fail.test(String(e)))
  assert.equal(output, '')
})

test('mixed-case credential marker is never admitted through composed planner route', async () => {
  const b = await historical()
  const row = b.results.find(r => r.key === 'plus:product')
  for (const fact of row.observations) {
    const u = new URL(fact.provenance.url)
    u.searchParams.set('ACCESS_TOKEN', 'FICTIONAL')
    fact.provenance.url = u.href
  }
  assert.throws(() => assessHistoricalM3FullBasketReadiness(b), fail)
})
