import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// Independent QA only: historical, six-shape M1 review fixture, fictional
// synthetic source IDs/clock/SHA. No retailer HTTP or rights granted.
const auditClock = '2026-10-15T21:00:00.000Z'
const afterActualArchive = '2026-10-14T12:00:00.000000001Z'
const beforeActualArchive = '2026-10-03T10:00:00.000Z'
const review = (a, b) =>
  comparePrivateRetailerFactChanges(a, b, { referenceTime: auditClock })

function reidentifyPlusCatalog(archived, capturedAt, keepFirst = false) {
  const changed = structuredClone(archived)
  const source = changed.results.find(x => x.accepted && x.key === 'plus:catalog')
  assert.ok(source, 'historical reviewed PLUS catalog source must exist')
  assert.ok(source.observations.length >= 2, 'real M1 archive must contain multiple catalog identities')
  assert.ok(source.observations.every(x =>
    Date.parse(x.provenance.capturedAt) > Date.parse(beforeActualArchive)))
  const old = archived.results.find(x => x.accepted && x.key === 'plus:catalog')
  for (let index = 0; index < source.observations.length; index++) {
    const observation = source.observations[index]
    assert.equal(observation.provenance.url, old.observations[index].provenance.url)
    observation.provenance.capturedAt = capturedAt
    observation.provenance.sha256 = 'b'.repeat(64) // a DIFFERENT imaginary source body
    if (!(keepFirst && index === 0)) {
      observation.sourceProductId = 'qa-fictional-replacement-' + index
    }
  }
  return { batch: changed, count: source.observations.length }
}

test('QA control: unchanged six historical source shapes report no additions or removals', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const report = review(original, structuredClone(original))
  assert.equal(report.totals.added, 0)
  assert.equal(report.totals.missing, 0)
  assert.equal(report.totals.unchanged, report.comparedProducts)
  assert.equal(report.externalRequests, 0)
  assert.equal(report.sourceRightsVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('QA control: genuinely later imaginary catalog can replace every source ID privately', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const { batch, count } = reidentifyPlusCatalog(original, afterActualArchive)
  const report = review(original, batch)
  assert.equal(report.perShape['plus:catalog'].missing, count)
  assert.equal(report.perShape['plus:catalog'].added, count)
  assert.equal(report.totals.missing, count)
  assert.equal(report.totals.added, count)
  assert.equal(report.historicalOnly, true)
  assert.equal(report.externalRequests, 0)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.livePricesAvailable, false)
})

test('QA control: older catalog with one stable identity is already rejected', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const { batch } = reidentifyPlusCatalog(original, beforeActualArchive, true)
  assert.throws(() => review(original, batch),
    /Private retailer fact change review refused/)
})

test('QA fail-closed: earlier catalog with entirely disjoint IDs cannot masquerade as later product turnover', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const { batch } = reidentifyPlusCatalog(original, beforeActualArchive)
  // The two catalog snapshots still have the same retailer, kind, HTTPS URL
  // and coverage. A fictional new SHA can legitimately change the products,
  // but not travel BACKWARDS in time and be reported as a new product update.
  // The present comparator only checks next.when < old.when for IDs that
  // overlap: 100% ID replacement bypasses that chronological guard.
  assert.throws(() => review(original, batch),
    /Private retailer fact change review refused/)
})
