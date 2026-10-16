import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  ingestReviewedEvidence,
  ingestReviewedBatch,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// QA2, frozen product owner: synthetic clock changes to checked-in, sanitized
// PLUS and DekaMarkt M1 source JSON. No live network, source right, price
// publication, customer account or credential access.
const FUTURE = '2099-10-16T12:00:00.123Z'

async function reviewed(name) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}

async function future(name) {
  const record = await reviewed(name)
  record.source.capturedAt = FUTURE
  return record
}

test('real archived PLUS and Deka product fixtures remain privately ingestible', async () => {
  for (const name of [
    'plus-rendered-product-halfvolle-melk.v1.json',
    'dekamarkt-product-halfvolle-melk.v1.json',
  ]) {
    const result = ingestReviewedEvidence(await reviewed(name))
    assert.equal(result.accepted, true, name)
    assert.ok(result.observations.length > 0, name)
  }
})

test('PLUS product parser must not turn a 2099 capture into an approved archived observation', async () => {
  const result = ingestReviewedEvidence(await future('plus-rendered-product-halfvolle-melk.v1.json'))
  assert.equal(result.accepted, false, 'future source time is not a historical capture')
  assert.deepEqual(result.observations, [])
})

test('DekaMarkt product parser must not turn a 2099 capture into an approved archived observation', async () => {
  const result = ingestReviewedEvidence(await future('dekamarkt-product-halfvolle-melk.v1.json'))
  assert.equal(result.accepted, false, 'future source time is not a historical capture')
  assert.deepEqual(result.observations, [])
})

test('mixed retailer batch cannot certify either future-dated product capture', async () => {
  const batch = ingestReviewedBatch([
    await future('plus-rendered-product-halfvolle-melk.v1.json'),
    await future('dekamarkt-product-halfvolle-melk.v1.json'),
  ])
  assert.equal(batch.summary.mode, 'reviewed-offline-only')
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
  assert.equal(batch.summary.acceptedSources, 0)
  assert.equal(batch.summary.rejectedSources, 2)
  assert.equal(batch.summary.observations, 0)
  assert.ok(batch.results.every(result => !result.accepted && result.observations.length === 0))
})

test('PLUS catalog already refuses the same synthetic future source instant', async () => {
  const result = ingestReviewedEvidence(await future('plus-rendered-catalog.v1.json'))
  assert.equal(result.accepted, false)
  assert.deepEqual(result.observations, [])
})

test('DekaMarkt offers already refuse the same synthetic future source instant', async () => {
  const result = ingestReviewedEvidence(await future('dekamarkt-offers.v1.json'))
  assert.equal(result.accepted, false)
  assert.deepEqual(result.observations, [])
})
