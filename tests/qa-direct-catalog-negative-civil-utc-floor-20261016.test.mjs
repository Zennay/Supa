import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { ingestCivilClockCheckedReviewedBatch } from '../scripts/retailer-private-civil-clock-preflight.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent QA of the DIRECT normalized-catalog entrypoint, not the opt-in
// civil-clock preflight. The latter correctly rejects impossible UTC-13/-14
// source envelopes, but direct JS callers can hand normalized observations
// to buildUniversalRetailerCatalog without passing through the adapters.
// All original records are checked-in sanitized historical M1 evidence.
// No network, source-rights mutation, live retailer or public pricing.
async function acceptedHistory() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  const originals = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
  return ingestCivilClockCheckedReviewedBatch(originals)
}

function samePhysicalInstantAtOffset(capturedAt, sign, hours, minutes = 0) {
  const displacementMinutes = (sign === '-' ? -1 : 1) * (hours * 60 + minutes)
  const local = new Date(Date.parse(capturedAt) + displacementMinutes * 60_000)
    .toISOString().slice(0, 23)
  const alias = local + sign +
    String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0')
  assert.equal(Date.parse(alias), Date.parse(capturedAt),
    'the test must change ONLY the civil-offset spelling, not the physical instant')
  return alias
}

function privateOnly(catalog, sourceCount) {
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.sourceCount, sourceCount)
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.ok(catalog.products.length > 0)
  for (const item of catalog.products) {
    assert.equal(item.publishable, false)
    assert.equal(item.sourceRightsVerified, false)
    assert.equal(item.currentTrustedPriceCents, null)
    assert.equal(item.selectedSnapshotSha256, null)
  }
}

test('real six-adapter historical observations remain private in direct normalized catalog', async () => {
  const batch = await acceptedHistory()
  assert.equal(batch.summary.acceptedSources, 6)
  privateOnly(buildUniversalRetailerCatalog(batch), 6)
})

test('all six shapes preserve physically identical legal UTC-12 and UTC+14 aliases in the direct catalog', async t => {
  const batch = await acceptedHistory()
  for (let index = 0; index < batch.results.length; index++) {
    const source = batch.results[index]
    for (const [sign, hours] of [['-', 12], ['+', 14]]) {
      await t.test(source.key + ' ' + sign + hours, () => {
        const copy = structuredClone(batch)
        for (const observation of copy.results[index].observations) {
          observation.provenance.capturedAt = samePhysicalInstantAtOffset(
            observation.provenance.capturedAt, sign, hours)
        }
        privateOnly(buildUniversalRetailerCatalog(copy), 6)
      })
    }
  }
})

test('direct catalog must reject UTC-13/UTC-14 provenance across every PLUS/Deka product, catalog and offer shape', async t => {
  const batch = await acceptedHistory()
  for (let index = 0; index < batch.results.length; index++) {
    const source = batch.results[index]
    for (const [hours, minutes] of [[12, 1], [13, 0], [14, 0]]) {
      await t.test(source.key + ' UTC-' + hours + ':' + String(minutes).padStart(2, '0'), () => {
        const copy = structuredClone(batch)
        for (const observation of copy.results[index].observations) {
          observation.provenance.capturedAt = samePhysicalInstantAtOffset(
            observation.provenance.capturedAt, '-', hours, minutes)
        }
        assert.throws(
          () => buildUniversalRetailerCatalog(copy),
          /(?:Invalid retailer capture UTC offset|Invalid retailer capture calendar or timestamp|Untrusted retailer capture)/,
          'unreal civil UTC offsets must not appear as accepted private catalog evidence',
        )
      })
    }
  }
})
