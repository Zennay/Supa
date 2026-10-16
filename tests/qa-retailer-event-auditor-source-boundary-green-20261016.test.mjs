import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { auditPrivateRetailerCaptureEvents } from '../scripts/qa-retailer-reviewed-event-consistency.mjs'

const clock = '2026-10-15T00:00:00.000Z'
const review = batch => auditPrivateRetailerCaptureEvents(batch, { asOf: clock })
const original = () => loadReviewedRepositoryFixtures()
const denied = /Private retailer event consistency QA refused/

test('original six M1 PLUS/Deka historical captures remain idempotent, private and immutable', async () => {
  const batch = structuredClone(await original())
  const unchanged = structuredClone(batch)
  const report = review(batch)
  assert.equal(report.sourceResults, 6)
  assert.equal(report.distinctPhysicalEvents, 6)
  assert.equal(report.reviewedObservations, 16)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
  assert.deepEqual(batch, unchanged)
})

for (const location of ['summary', 'observation', 'provenance']) {
  test('event review refuses hostile ' + location + ' accessor before invoking it', async () => {
    const batch = structuredClone(await original())
    const target = location === 'summary' ? batch.summary
      : location === 'observation' ? batch.results[0].observations[0]
        : batch.results[0].observations[0].provenance
    const field = location === 'summary' ? 'mode'
      : location === 'observation' ? 'sourceProductId' : 'url'
    let called = 0
    Object.defineProperty(target, field, {
      enumerable: true, configurable: true,
      get() {
        called++
        throw new Error('ACTIVE_SOURCE_EVENT_GETTER')
      },
    })
    assert.throws(() => review(batch), denied)
    assert.equal(called, 0, 'review must inspect property DESCRIPTORS, not getters')
  })
}

test('event review refuses summary Proxy before get trap executes', async () => {
  const batch = structuredClone(await original())
  let calls = 0
  batch.summary = new Proxy(batch.summary, {
    get() {
      calls++
      throw new Error('ACTIVE_SOURCE_EVENT_PROXY')
    },
  })
  assert.throws(() => review(batch), denied)
  assert.equal(calls, 0)
})

for (const key of ['plus:catalog', 'dekamarkt:offers']) {
  for (const suffix of ['?', '#', '?#']) {
    test('event review refuses unreviewed ' + JSON.stringify(suffix) +
      ' raw source URL suffix for ' + key, async () => {
      const batch = structuredClone(await original())
      const source = batch.results.find(row => row.key === key)
      assert.ok(source && source.observations.length)
      const unique = new Set(source.observations.map(row => row.provenance))
      for (const provenance of unique) provenance.url += suffix
      assert.throws(() => review(batch), denied)
    })
  }
}

test('event review rejects nested Proxy observations and sparse arrays without running traps', async () => {
  const proxyBatch = structuredClone(await original())
  let calls = 0
  proxyBatch.results[0].observations[0] =
    new Proxy(proxyBatch.results[0].observations[0], {
      get() {
        calls++
        throw new Error('ACTIVE_SOURCE_EVENT_NESTED_PROXY')
      },
    })
  assert.throws(() => review(proxyBatch), denied)
  assert.equal(calls, 0)
  const sparse = structuredClone(await original())
  delete sparse.results[0].observations[0]
  assert.throws(() => review(sparse), denied)
})
