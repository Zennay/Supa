import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parseDekaMarktSsrOffersEvidence } from '../src/data/dekaMarktSsrListings.ts'

// The fixture is original reviewed M1 evidence. Timestamp edits below are
// deliberately synthetic counterfactuals, never live offers or new prices.
async function originalOffers() {
  return JSON.parse(await readFile(
    new URL('../fixtures/m1/dekamarkt-offers.v1.json', import.meta.url),
    'utf8',
  ))
}

function acceptedIds(record) {
  const result = parseDekaMarktSsrOffersEvidence(record)
  assert.equal(result.type, 'observations')
  return { result, ids: result.observations.map(row => row.sourceProductId) }
}

test('original three offline Deka offers are accepted unchanged', async () => {
  const { result, ids } = acceptedIds(await originalOffers())
  assert.deepEqual(ids, ['47936', '4579', '57593'])
  assert.equal(result.abstained, 0)
})

test('offer group start after end by 1 nanosecond is not accepted', async () => {
  const record = await originalOffers()
  record.nuxtPayload[9] = '2026-09-29T00:00:00.000000002Z'
  record.nuxtPayload[10] = '2026-09-29T00:00:00.000000001Z'
  const { result, ids } = acceptedIds(record)
  assert.deepEqual(ids, ['4579', '57593'])
  assert.equal(result.abstained, 1)
})

test('product-specific start after end by 1 ns cannot override valid offer group', async () => {
  const record = await originalOffers()
  const start = record.nuxtPayload.push('2026-09-29T00:00:00.000000002Z') - 1
  const end = record.nuxtPayload.push('2026-09-29T00:00:00.000000001Z') - 1
  record.nuxtPayload[15].startDate = start
  record.nuxtPayload[15].endDate = end
  const { result, ids } = acceptedIds(record)
  assert.deepEqual(ids, ['4579', '57593'])
  assert.equal(result.abstained, 1)
})

test('physically ordered 1 ns interval within one millisecond stays valid', async () => {
  const record = await originalOffers()
  record.nuxtPayload[9] = '2026-09-29T00:00:00.000000001Z'
  record.nuxtPayload[10] = '2026-09-29T00:00:00.000000002Z'
  const { result, ids } = acceptedIds(record)
  assert.deepEqual(ids, ['47936', '4579', '57593'])
  assert.equal(result.abstained, 0)
  assert.equal(result.observations[0].offer.validFrom, record.nuxtPayload[9])
  assert.equal(result.observations[0].offer.validTo, record.nuxtPayload[10])
})

test('same absolute nanosecond in two UTC offsets is a valid zero-length interval', async () => {
  const record = await originalOffers()
  record.nuxtPayload[9] = '2026-09-29T02:00:00.000000001+02:00'
  record.nuxtPayload[10] = '2026-09-29T00:00:00.000000001Z'
  const { result, ids } = acceptedIds(record)
  assert.deepEqual(ids, ['47936', '4579', '57593'])
  assert.equal(result.abstained, 0)
})

test('offset-adjusted absolute reverse ordering by 1 ns is rejected', async () => {
  const record = await originalOffers()
  record.nuxtPayload[9] = '2026-09-29T02:00:00.000000002+02:00'
  record.nuxtPayload[10] = '2026-09-29T00:00:00.000000001Z'
  const { result, ids } = acceptedIds(record)
  assert.deepEqual(ids, ['4579', '57593'])
  assert.equal(result.abstained, 1)
})
