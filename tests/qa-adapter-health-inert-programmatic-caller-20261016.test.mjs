/**
 * Independent M3 QA for the exported private six-adapter health boundary.
 * All good data comes from the committed PLUS/Deka historical M1 six-shape
 * fixtures. Mutations are fictional programmatic JavaScript objects ONLY:
 * no retailer network, new prices, permissions, publication or user records.
 *
 * This test must remain unchanged for product-owned RED -> GREEN replay.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'

const referenceTime = '2026-10-16T06:00:00Z'
const evaluate = batch => evaluatePrivateAdapterHealth(batch, { referenceTime })

test('historical six-shape PLUS/Deka health remains private and rejects current-price claims', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const report = evaluate(batch)
  assert.equal(report.sources, 6)
  assert.equal(report.acceptedSources, 6)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.externalRequests, 0)
  assert.ok(report.operatorActions.includes('obtain-written-retailer-source-rights'))
  assert.ok(report.operatorActions.includes('collect-genuine-two-store-m3-basket-evidence'))
  assert.doesNotMatch(JSON.stringify(report),
    /https?:\/\/|access_token|currentPriceCents|offerPriceCents|sourceProductId|snapshotSha256/)
})

test('direct adapter health refuses a root Proxy before executing any get trap [EXPECTED RED]', async () => {
  const original = await loadReviewedRepositoryFixtures()
  let traps = 0
  const caller = new Proxy(original, {
    get() { traps++; throw new Error('QA SYNTHETIC ROOT PROXY GET LEAK') },
  })
  assert.throws(() => evaluate(caller), /Private retailer adapter health review refused/)
  assert.equal(traps, 0, 'untrusted user code must never run in a refusal')
})

test('direct adapter health refuses an accessor summary without running it [EXPECTED RED]', async () => {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  let traps = 0
  Object.defineProperty(batch, 'summary', {
    enumerable: true, configurable: true,
    get() { traps++; throw new Error('QA SYNTHETIC SUMMARY ACCESSOR LEAK') },
  })
  assert.throws(() => evaluate(batch), /Private retailer adapter health review refused/)
  assert.equal(traps, 0)
})

test('direct adapter health refuses a nested active Proxy before reading mode [EXPECTED RED]', async () => {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  let traps = 0
  batch.summary = new Proxy(batch.summary, {
    get() { traps++; throw new Error('QA SYNTHETIC NESTED PROXY LEAK') },
  })
  assert.throws(() => evaluate(batch), /Private retailer adapter health review refused/)
  assert.equal(traps, 0)
})

test('direct adapter health refuses revoked Proxy with domain error rather than native TypeError [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const holder = Proxy.revocable(batch, {})
  holder.revoke()
  assert.throws(() => evaluate(holder.proxy), error =>
    !(error instanceof TypeError) &&
    /Private retailer adapter health review refused/.test(String(error)))
})

test('direct adapter health does not admit inherited production permission metadata [EXPECTED RED]', async () => {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  assert.equal(batch.summary.productionEnabled, false)
  delete batch.summary.productionEnabled
  Object.setPrototypeOf(batch.summary, { productionEnabled: false })
  assert.throws(() => evaluate(batch), /Private retailer adapter health review refused/)
})

test('direct adapter health refuses active nested capture provenance getter before validation [EXPECTED RED]', async () => {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  const provenance = batch.results.find(row => row.accepted).observations[0].provenance
  let traps = 0
  Object.defineProperty(provenance, 'capturedAt', {
    enumerable: true, configurable: true,
    get() { traps++; throw new Error('QA SYNTHETIC CAPTURE CLOCK ACCESSOR LEAK') },
  })
  assert.throws(() => evaluate(batch), /Private retailer adapter health review refused/)
  assert.equal(traps, 0)
})
