import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  auditPrivateRetailerCaptureEvents,
  main,
} from '../scripts/qa-retailer-reviewed-event-consistency.mjs'

const asOf = '2026-10-15T00:00:00.000Z'
const review = batch => auditPrivateRetailerCaptureEvents(batch, { asOf })
const denial = /Private retailer event consistency QA refused/

function addReplay(batch, retailer, kind) {
  const copy = structuredClone(batch.results.find(r => r.key === retailer + ':' + kind))
  assert.ok(copy)
  batch.results.push(copy)
  batch.summary.sources += 1
  batch.summary.acceptedSources += 1
  batch.summary.observations += copy.observations.length
  batch.summary.retailerCounts[retailer] += copy.observations.length
  return copy
}

test('six genuine offline reviewed PLUS/Deka source types produce private aggregate integrity without prices', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const before = structuredClone(batch)
  const result = review(batch)
  assert.equal(result.mode, 'offline-reviewed-retailer-event-integrity-qa')
  assert.equal(result.sourceResults, 6)
  assert.equal(result.distinctPhysicalEvents, 6)
  assert.equal(result.idempotentEventReplays, 0)
  assert.equal(result.reviewedObservations, 16)
  assert.equal(result.retailerScopedProducts, 13)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.externalRequests, 0)
  assert.deepEqual(batch, before, 'quality audit may not mutate evidence')
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /https?:\/\/|Zuivelmeester|sourceProductId|snapshotSha256|price_cents|offerPriceCents|capturedAt/i)
})

test('repeated identical physical source event is idempotent, does not add a new capture', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const extra = addReplay(batch, 'plus', 'catalog')
  assert.ok(extra.observations.length > 1)
  const report = review(batch)
  assert.equal(report.sourceResults, 7)
  assert.equal(report.distinctPhysicalEvents, 6)
  assert.equal(report.idempotentEventReplays, 1)
  assert.equal(report.retailerScopedProducts, 13)
  assert.equal(report.reviewedObservations, 16 + extra.observations.length)
})

test('same physical source event cannot be replayed with altered price or availability', async t => {
  for (const [name, update] of [
    ['money', o => { o.currentPriceCents = o.currentPriceCents === null ? 100 : o.currentPriceCents + 1 }],
    ['availability', o => { o.availability = o.availability === 'available' ? 'unknown' : 'available' }],
    ['packaging', o => { o.pack.rawText = 'Different fictional package' }],
  ]) {
    await t.test(name, async () => {
      const batch = await loadReviewedRepositoryFixtures()
      const copy = addReplay(batch, 'dekamarkt', 'product')
      update(copy.observations[0])
      assert.throws(() => review(batch), denial)
    })
  }
})

test('same SHA/time/source cannot rewrite observed product set without a new capture', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const extra = addReplay(batch, 'plus', 'catalog')
  assert.ok(extra.observations.length > 1)
  extra.observations.pop()
  batch.summary.observations--
  batch.summary.retailerCounts.plus--
  assert.throws(() => review(batch), denial)
})

test('identical content hash at a different real capture time is a distinct physical event', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const extra = addReplay(batch, 'plus', 'product')
  extra.observations[0].provenance.capturedAt = '2026-10-05T12:00:00.000Z'
  const report = review(batch)
  assert.equal(report.sourceResults, 7)
  assert.equal(report.distinctPhysicalEvents, 7)
  assert.equal(report.idempotentEventReplays, 0)
})

test('same SKU text across different retailers stays scoped, never becomes a combined item', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const plus = batch.results.find(r => r.key === 'plus:product').observations[0]
  const deka = batch.results.find(r => r.key === 'dekamarkt:product').observations[0]
  deka.sourceProductId = plus.sourceProductId
  const report = review(batch)
  assert.equal(report.retailerScopedProducts, 13)
  assert.equal(report.productionEnabled, false)
})

test('rights forgery, source counter contradictions, invalid money and future capture never pass integrity review', async t => {
  const bad = [
    ['forged production flag', b => { b.summary.productionEnabled = true }],
    ['forged permission flag', b => { b.summary.permissionVerified = true }],
    ['forged public financial claims', b => { b.summary.publicSavingsClaimEligible = true }],
    ['invented successful observations', b => { b.summary.observations += 1 }],
    ['invented retailer-specific count', b => { b.summary.retailerCounts.plus += 1 }],
    ['unsafe money', b => { b.results[0].observations[0].currentPriceCents = Number.MAX_SAFE_INTEGER + 1 }],
    ['noncanonical time', b => { b.results[0].observations[0].provenance.capturedAt = '2026-02-30T12:00:00.000Z' }],
    ['future source time', b => { b.results[0].observations[0].provenance.capturedAt = '2035-01-01T00:00:00.000Z' }],
    ['credential-bearing URL', b => { b.results[0].observations[0].provenance.url = 'https://fake:secret@www.plus.nl/producten' }],
    ['unknown retailer scope', b => { b.results[0].key = 'ah:product' }],
  ]
  for (const [label, change] of bad) {
    await t.test(label, async () => {
      const batch = await loadReviewedRepositoryFixtures()
      change(batch)
      assert.throws(() => review(batch), denial)
    })
  }
})

test('CLI reads only six bounded built-in offline fixtures and exposes aggregate privacy-safe report', async () => {
  const chunks = []
  const result = await main([], text => chunks.push(text))
  assert.equal(result.reviewedObservations, 16)
  assert.deepEqual(JSON.parse(chunks.join('')), result)
  assert.doesNotMatch(chunks.join(''), /https?:\/\/|Zuivelmeester|price_cents|offerPriceCents|sourceProductId|token:/i)
  await assert.rejects(() => main(['https://www.plus.nl'], () => {}), denial)
  const cli = new URL('../scripts/qa-retailer-reviewed-event-consistency.mjs', import.meta.url).pathname
  const command = spawnSync(process.execPath, ['--experimental-strip-types', cli], {
    timeout: 30000, encoding: 'utf8', maxBuffer: 64 * 1024,
  })
  assert.equal(command.status, 0, command.stderr)
  assert.deepEqual(JSON.parse(command.stdout), result)
})
