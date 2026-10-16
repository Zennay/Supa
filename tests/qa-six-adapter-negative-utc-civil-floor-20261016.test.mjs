import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  ingestReviewedBatch,
  ingestReviewedEvidence,
  RETAILER_REVIEWED_FIXTURES,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Quality-validation 1/2: exact historical sanitized M1 sources, in memory
// only. The *physical instant* is never changed; only its UTC offset spelling.
// UTC's actual civil range is -12:00 through +14:00, not symmetric +/-14.
// No live retailer requests, source rights, production prices or permissions.
async function archived(filename) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + filename, import.meta.url), 'utf8'))
}

function equivalentOffset(utcTimestamp, offsetMinutes) {
  assert.match(utcTimestamp, /Z$/)
  const millis = Date.parse(utcTimestamp)
  assert.ok(Number.isFinite(millis))
  const sign = offsetMinutes < 0 ? '-' : '+'
  const magnitude = Math.abs(offsetMinutes)
  const hours = String(Math.floor(magnitude / 60)).padStart(2, '0')
  const minutes = String(magnitude % 60).padStart(2, '0')
  const local = new Date(millis + offsetMinutes * 60_000)
    .toISOString().replace(/Z$/, '')
  const alias = local + sign + hours + ':' + minutes
  assert.equal(Date.parse(alias), millis, 'same real capture instant')
  return alias
}

function privateFlags(summary) {
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.permissionVerified, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
}

test('all six unchanged checked-in PLUS and Deka product/catalog/offer fixtures pass only as private observations', async () => {
  const records = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(archived))
  const { summary } = ingestReviewedBatch(records)
  assert.equal(summary.sources, 6)
  assert.equal(summary.acceptedSources, 6)
  assert.equal(summary.rejectedSources, 0)
  assert.ok(summary.observations >= 6)
  privateFlags(summary)
})

for (const filename of RETAILER_REVIEWED_FIXTURES) {
  for (const [offsetLabel, offsetMinutes] of [
    ['legal -12:00 civil lower bound', -12 * 60],
    ['legal +14:00 civil upper bound', 14 * 60],
  ]) {
    test(filename + ' preserves valid ' + offsetLabel + ' for historical capture', async () => {
      const record = await archived(filename)
      const original = record.source.capturedAt
      record.source.capturedAt = equivalentOffset(original, offsetMinutes)
      assert.notEqual(record.source.capturedAt, original)
      const result = ingestReviewedEvidence(record)
      assert.equal(result.accepted, true, 'legal offset notation must not erase the identical reviewed instant')
      assert.ok(result.observations.length > 0)
    })
  }

  for (const [offsetLabel, offsetMinutes] of [
    ['impossible -12:01', -(12 * 60 + 1)],
    ['impossible -13:00', -13 * 60],
    ['impossible -14:00', -14 * 60],
  ]) {
    test(filename + ' refuses ' + offsetLabel + ' even though its physical UTC instant is unchanged', async () => {
      const record = await archived(filename)
      const original = record.source.capturedAt
      record.source.capturedAt = equivalentOffset(original, offsetMinutes)
      assert.notEqual(record.source.capturedAt, original)
      const result = ingestReviewedEvidence(record)
      assert.equal(result.accepted, false, 'unreal civil UTC offset must not certify a reviewed capture')
      assert.deepEqual(result.observations, [])
    })
  }

  test(filename + ' already refuses impossible +14:01 as a matching boundary control', async () => {
    const record = await archived(filename)
    record.source.capturedAt = equivalentOffset(record.source.capturedAt, 14 * 60 + 1)
    const result = ingestReviewedEvidence(record)
    assert.equal(result.accepted, false)
    assert.deepEqual(result.observations, [])
  })
}

test('mixed six-adapter batch cannot credit impossible -13:00 captures as independent price evidence', async () => {
  const records = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(archived))
  for (const record of records) record.source.capturedAt = equivalentOffset(record.source.capturedAt, -13 * 60)
  const { summary, results } = ingestReviewedBatch(records)
  assert.equal(summary.sources, 6)
  assert.equal(summary.acceptedSources, 0)
  assert.equal(summary.rejectedSources, 6)
  assert.equal(summary.observations, 0)
  assert.ok(results.every(result => result.accepted === false && result.observations.length === 0))
  privateFlags(summary)
})
