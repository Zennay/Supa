/**
 * Independent M3 QA, second direct health trust boundary: options must be
 * an inert own-data record before even destructuring referenceTime/maxAgeHours.
 * Uses only committed historical PLUS/Deka six-source fixtures, no network.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'

const referenceTime = '2026-10-16T06:00:00Z'
const refusal = /Private retailer adapter health review refused/

test('normal explicit own audit clock remains historical only', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const result = evaluatePrivateAdapterHealth(batch, { referenceTime, maxAgeHours: 24 })
  assert.equal(result.sources, 6)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.externalRequests, 0)
})

test('active referenceTime getter cannot execute during exported health options destructuring [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let traps = 0
  const opts = {}
  Object.defineProperty(opts, 'referenceTime', {
    enumerable: true, get() { traps++; throw new Error('QA SYNTHETIC CLOCK GETTER RUN') },
  })
  assert.throws(() => evaluatePrivateAdapterHealth(batch, opts), refusal)
  assert.equal(traps, 0)
})

test('active maxAgeHours getter cannot execute during exported health options destructuring [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let traps = 0
  const opts = { referenceTime }
  Object.defineProperty(opts, 'maxAgeHours', {
    enumerable: true, get() { traps++; throw new Error('QA SYNTHETIC AGE GETTER RUN') },
  })
  assert.throws(() => evaluatePrivateAdapterHealth(batch, opts), refusal)
  assert.equal(traps, 0)
})

test('revoked options Proxy refuses by domain error not native JS TypeError [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const opts = Proxy.revocable({ referenceTime, maxAgeHours: 24 }, {})
  opts.revoke()
  assert.throws(() => evaluatePrivateAdapterHealth(batch, opts.proxy), error =>
    !(error instanceof TypeError) && refusal.test(String(error)))
})

test('inherited audit reference time cannot act as own reviewer evidence [EXPECTED RED]', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const opts = Object.create({ referenceTime })
  opts.maxAgeHours = 24
  assert.throws(() => evaluatePrivateAdapterHealth(batch, opts), refusal)
})
