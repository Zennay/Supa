import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseDekaMarktSsrOffersEvidence } from '../src/data/dekaMarktSsrListings.ts'

// Independent positive acceptance for the *source-time vs promotion-time*
// distinction. These are offline copies of existing sanitized M1 evidence,
// not newly fetched offers or claims that a discount is current.
const original = async () => JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-offers.v1.json', import.meta.url), 'utf8',
))

test('a completed historical Deka capture can archive a future promotional end without losing source identity', async () => {
  const data = await original()
  const capturedAt = data.source.capturedAt
  const end = '2026-10-25T00:00:00.000Z'
  data.nuxtPayload[10] = end // first offer has matching outer and product references
  const result = parseDekaMarktSsrOffersEvidence(data)
  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 3)
  assert.equal(result.abstained, 0)
  assert.equal(result.observations[0].offer.validTo, end)
  for (const observation of result.observations) {
    assert.equal(observation.provenance.capturedAt, capturedAt)
    assert.equal(observation.provenance.url, data.source.url)
    assert.equal(observation.provenance.sha256, data.source.sha256)
  }
})

test('a future-start promotion is historical structured data, not proof it is active now', async () => {
  const data = await original()
  data.nuxtPayload[9] = '2026-10-20T00:00:00.000Z'
  data.nuxtPayload[10] = '2026-10-25T00:00:00.000Z'
  const result = parseDekaMarktSsrOffersEvidence(data)
  assert.equal(result.type, 'observations')
  assert.equal(result.observations[0].offer.validFrom, data.nuxtPayload[9])
  assert.equal(result.observations[0].offer.validTo, data.nuxtPayload[10])
  assert.ok(Date.parse(result.observations[0].offer.validFrom) > Date.parse(data.source.capturedAt))
  assert.equal(result.observations[0].provenance.capturedAt, data.source.capturedAt)
  // The parser preserves historical fields; no live promotion decision is made here.
  assert.equal(Object.hasOwn(result.observations[0], 'currentlyOnOffer'), false)
})

test('an exact physically equivalent UTC-offset source capture remains accepted and traceable', async () => {
  const data = await original()
  const originalClock = data.source.capturedAt
  data.source.capturedAt = '2026-10-04T20:15:30.693+02:00'
  assert.equal(Date.parse(data.source.capturedAt), Date.parse(originalClock))
  const result = parseDekaMarktSsrOffersEvidence(data)
  assert.equal(result.type, 'observations')
  assert.equal(result.abstained, 0)
  assert.ok(result.observations.length > 0)
  assert.ok(result.observations.every(row =>
    row.provenance.capturedAt === data.source.capturedAt &&
    row.provenance.sha256 === data.source.sha256))
})

test('future capture is rejected even when the same future promotional window remains structurally valid', async () => {
  const data = await original()
  data.nuxtPayload[9] = '2026-10-20T00:00:00.000Z'
  data.nuxtPayload[10] = '2026-10-25T00:00:00.000Z'
  data.source.capturedAt = '2099-10-04T18:15:30.693Z'
  const result = parseDekaMarktSsrOffersEvidence(data)
  assert.equal(result.type, 'abstain')
  assert.equal(Object.hasOwn(result, 'observations'), false)
})
