import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  RETAILER_REVIEWED_FIXTURES,
  ingestReviewedEvidence,
  ingestReviewedBatch,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Product-core source-integrity tests. Historical sanitized local fixtures only,
// no external HTTP, retailer permission promotion or checkout-price claims.
async function fixture(name) {
  return JSON.parse(await readFile(
    new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}

test('all six approved source shapes deny fictional future capture clocks BEFORE adapters', async () => {
  const future = []
  for (const name of RETAILER_REVIEWED_FIXTURES) {
    const record = await fixture(name)
    const good = ingestReviewedEvidence(record)
    assert.equal(good.accepted, true, name + ' original historical fixture')
    record.source.capturedAt = '2099-12-31T23:59:59.999Z'
    const rejected = ingestReviewedEvidence(record)
    assert.equal(rejected.accepted, false, name)
    assert.equal(rejected.reason, 'invalid-or-future-capture')
    assert.deepEqual(rejected.observations, [])
    future.push(record)
  }
  const batch = ingestReviewedBatch(future)
  assert.equal(batch.summary.sources, 6)
  assert.equal(batch.summary.rejectedSources, 6)
  assert.equal(batch.summary.acceptedSources, 0)
  assert.equal(batch.summary.observations, 0)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
})

test('unknown or absent source capture clocks cannot become reviewed observations', async () => {
  const original = await fixture(RETAILER_REVIEWED_FIXTURES[0])
  for (const value of [null, '', 'nonsense', 2099, '2099-12-31T23:59:59Z']) {
    const record = structuredClone(original)
    record.source.capturedAt = value
    const result = ingestReviewedEvidence(record)
    assert.equal(result.accepted, false)
    assert.equal(result.reason, 'invalid-or-future-capture')
    assert.deepEqual(result.observations, [])
  }
})
