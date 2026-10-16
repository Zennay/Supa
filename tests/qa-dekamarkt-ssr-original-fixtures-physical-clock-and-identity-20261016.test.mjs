import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

// Original reviewed M1 snapshot containers, with synthetic in-memory payload
// mutations only. The source fixture itself remains unmodified and historical.
// No permissions, live HTTP, current stock or public savings are proven here.
const fixture = async name => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + name, import.meta.url), 'utf8',
))
const ids = result => result.type === 'observations'
  ? result.observations.map(x => x.sourceProductId).sort()
  : []

test('independent Deka original offer control retains three historical ids and unknown stock', async () => {
  const record = await fixture('dekamarkt-offers.v1.json')
  const original = structuredClone(record)
  const result = parseDekaMarktSsrOffersEvidence(record)
  assert.equal(result.type, 'observations')
  assert.deepEqual(ids(result), ['4579', '47936', '57593'])
  assert.equal(result.abstained, 0)
  assert.ok(result.observations.every(x =>
    x.availability === 'unknown' && x.provenance.capturedAt === original.source.capturedAt))
  assert.deepEqual(record, original, 'parser may not rewrite reviewed source records')
})

test('independent Deka offer: reversed 1ns product-specific offset chronology removes only that ambiguous record', async () => {
  const record = await fixture('dekamarkt-offers.v1.json')
  const original = structuredClone(record)
  const from = record.nuxtPayload.push('2026-09-29T02:00:00.000000002+02:00') - 1
  const to = record.nuxtPayload.push('2026-09-29T00:00:00.000000001Z') - 1
  record.nuxtPayload[15].startDate = from
  record.nuxtPayload[15].endDate = to
  const before = structuredClone(record)
  const result = parseDekaMarktSsrOffersEvidence(record)
  assert.equal(result.type, 'observations')
  assert.deepEqual(ids(result), ['4579', '57593'])
  assert.equal(result.abstained, 1)
  assert.deepEqual(record, before, 'parser must never normalize a lying 1ns time in-place')
  assert.notDeepEqual(record, original, 'QA test must actually exercise a synthetic mutation')
})

test('independent Deka offer: exact equal physical instants across ±04 offset preserve all originals', async () => {
  const record = await fixture('dekamarkt-offers.v1.json')
  record.nuxtPayload[9] = '2026-09-29T04:00:00.123456789+04:00'
  record.nuxtPayload[10] = '2026-09-29T00:00:00.123456789Z'
  const result = parseDekaMarktSsrOffersEvidence(record)
  assert.equal(result.type, 'observations')
  assert.deepEqual(ids(result), ['4579', '47936', '57593'])
  assert.equal(result.abstained, 0)
  assert.equal(result.observations[0].offer.validFrom, record.nuxtPayload[9])
  assert.equal(result.observations[0].offer.validTo, record.nuxtPayload[10])
})

test('independent Deka offer: duplicate product refs within same offer group refuse whole evidence', async () => {
  const record = await fixture('dekamarkt-offers.v1.json')
  record.nuxtPayload[16] = [15, 15]
  const result = parseDekaMarktSsrOffersEvidence(record)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /duplicate product identities/)
})

test('independent Deka catalog: distinct product slots referring to same identity refuse batch', async () => {
  const record = await fixture('dekamarkt-catalog-melk.v1.json')
  record.nuxtPayload[28] = [11, 11, 27]
  const result = parseDekaMarktSsrCatalogEvidence(record)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /duplicate product identities/)
})

test('independent Deka timing: more than 9 fractional digits abstain rather than truncating into an accepted discount', async () => {
  const record = await fixture('dekamarkt-offers.v1.json')
  record.nuxtPayload[9] = '2026-09-29T00:00:00.0000000001Z'
  const result = parseDekaMarktSsrOffersEvidence(record)
  assert.equal(result.type, 'observations')
  assert.deepEqual(ids(result), ['4579', '57593'])
  assert.equal(result.abstained, 1)
})
