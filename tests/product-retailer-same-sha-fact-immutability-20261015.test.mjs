import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

const at = '2026-10-15T21:00:00.000Z'
const later = '2026-10-14T12:00:00.000000001Z'
const compare = (before, after) =>
  comparePrivateRetailerFactChanges(before, after, { referenceTime: at })
function cloneCapture(archive, edit, changedSha = false) {
  const current = structuredClone(archive)
  const item = current.results.find(x => x.key === 'plus:product' && x.accepted)
  for (const obs of item.observations) {
    obs.provenance.capturedAt = later
    if (changedSha) obs.provenance.sha256 = 'c'.repeat(64)
  }
  edit(item.observations[0])
  return current
}

test('product: a constant raw SHA/URL cannot mask name and pack changes as source facts', async () => {
  const old = await loadReviewedRepositoryFixtures()
  for (const mutate of [
    obs => { obs.name = obs.name + ' FICTIVE' },
    obs => { obs.pack.amount = (obs.pack.amount ?? 100) + 1 },
  ]) {
    const now = cloneCapture(old, mutate)
    assert.throws(() => compare(old, now), /Private retailer fact change review refused/)
  }
})

test('product: different approved historical SHA can reflect pack/name edits in private counts', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const now = cloneCapture(old, obs => {
    obs.name += ' FICTIONAL'
    obs.pack.amount = (obs.pack.amount ?? 100) + 1
  }, true)
  const report = compare(old, now)
  assert.equal(report.perShape['plus:product'].nameChanged, 1)
  assert.equal(report.perShape['plus:product'].packChanged, 1)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
})

test('product: same source SHA with only more recent nanosecond event remains unchanged', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const now = cloneCapture(old, () => {})
  const report = compare(old, now)
  assert.equal(report.totals.priceChanged, 0)
  assert.equal(report.totals.availabilityChanged, 0)
  assert.equal(report.totals.packChanged, 0)
  assert.equal(report.totals.unchanged, report.comparedProducts)
  assert.equal(report.sourceRightsVerified, false)
  assert.equal(report.externalRequests, 0)
})

test('product: unchanged reviewed six-source batch remains private and stable', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const result = compare(archived, archived)
  assert.equal(result.comparedProducts > 0, true)
  assert.equal(result.totals.priceChanged, 0)
  assert.equal(result.totals.offerChanged, 0)
  assert.equal(result.totals.availabilityChanged, 0)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})
