import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { reviewPrivateRetailerOffers } from '../scripts/qa-retailer-offer-baseline-corroboration.mjs'
import { auditPrivateRetailerCaptureEvents } from '../scripts/qa-retailer-reviewed-event-consistency.mjs'

// Independent offline QA: all six historical fixture sources remain untouched.
// A bare punctuation suffix changes reviewed source URL bytes even when WHATWG
// URL.search/hash normalize to empty strings. No network or rights mutations.
const asOf = '2026-10-15T00:00:00.000Z'
const original = () => loadReviewedRepositoryFixtures()
const offerAudit = batch => reviewPrivateRetailerOffers(batch, { asOf })
const eventAudit = batch => auditPrivateRetailerCaptureEvents(batch, { asOf })

test('six original reviewed historical shapes remain accepted by both private QA exports', async () => {
  const batch = structuredClone(await original())
  const unchanged = structuredClone(batch)
  const offer = offerAudit(batch)
  const events = eventAudit(batch)
  assert.equal(offer.sourceKinds, 6)
  assert.equal(events.sourceResults, 6)
  assert.equal(offer.productionEnabled, false)
  assert.equal(events.productionEnabled, false)
  assert.equal(offer.publicSavingsClaimEligible, false)
  assert.equal(events.publicSavingsClaimEligible, false)
  assert.equal(events.externalRequests, 0)
  assert.deepEqual(batch, unchanged)
})

for (const key of ['plus:catalog', 'dekamarkt:offers']) {
  for (const suffix of ['?', '#', '?#']) {
    test('bare source URL suffix ' + JSON.stringify(suffix) +
      ' on ' + key + ' cannot pass direct offer and event evidence QA', async t => {
      const batch = structuredClone(await original())
      const selected = batch.results.find(row => row.key === key)
      assert.ok(selected?.accepted)
      assert.ok(selected.observations.length)
      const reviewedUrl = selected.observations[0].provenance.url
      // Adapter rows can share the same provenance object; modify each
      // distinct archived source envelope exactly once, not once per SKU.
      const sourceEnvelopes = new Set(selected.observations.map(row => row.provenance))
      for (const provenance of sourceEnvelopes) {
        assert.equal(provenance.url, reviewedUrl)
        provenance.url += suffix
      }
      assert.notEqual(reviewedUrl + suffix, reviewedUrl)
      assert.equal(new URL(reviewedUrl + suffix).search, '')
      assert.equal(new URL(reviewedUrl + suffix).hash, '')
      await t.test('offer baseline review rejects unreviewed URL bytes', () => {
        assert.throws(() => offerAudit(batch),
          /Private retailer offer corroboration QA refused/)
      })
      await t.test('capture event review rejects unreviewed URL bytes', () => {
        assert.throws(() => eventAudit(batch),
          /Private retailer event consistency QA refused/)
      })
    })
  }
}
