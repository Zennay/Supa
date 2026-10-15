import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// QA-only offline counterexample: absent or rejected adapter coverage is
// NOT evidence that a supermarket product disappeared from its source.
const referenceTime = '2026-10-15T21:00:00.000Z'
const review = (previous, current) =>
  comparePrivateRetailerFactChanges(previous, current, { referenceTime })

function losePlusProductSource(previous, removeEntirely) {
  const current = structuredClone(previous)
  const index = current.results.findIndex(row =>
    row.accepted && row.key === 'plus:product')
  assert.notEqual(index, -1, 'actual reviewed PLUS product adapter input required')
  const row = current.results[index]
  const count = row.observations.length
  assert.ok(count > 0)
  current.summary.acceptedSources--
  current.summary.observations -= count
  current.summary.retailerCounts.plus -= count
  if (removeEntirely) {
    current.results.splice(index, 1)
    current.summary.sources--
  } else {
    row.accepted = false
    row.reason = 'adapter-refused'
    row.observations = []
    current.summary.rejectedSources++
  }
  return current
}

test('QA control: exact reviewed six-source replay has no missing product claims', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const report = review(archived, structuredClone(archived))
  assert.equal(report.totals.missing, 0)
  assert.equal(report.totals.added, 0)
  assert.equal(report.totals.unchanged, report.comparedProducts)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('QA fail-closed: an adapter rejection cannot be described as products missing in a later store catalog', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const current = losePlusProductSource(archived, false)
  const health = evaluatePrivateAdapterHealth(current, { referenceTime })
  assert.equal(health.byShape['plus:product'].rejected, 1)
  assert.equal(health.sixShapeCoverageComplete, false)
  // A rejected HTML/source parser tells us nothing about disappearance.
  // The private change review must reject incomparable source coverage,
  // not transform parser failure into a product-level 'missing' count.
  assert.throws(() => review(archived, current), /Private retailer fact change review refused/)
})

test('QA fail-closed: a source omitted entirely is unknown coverage, not source-product removal', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  const current = losePlusProductSource(archived, true)
  const health = evaluatePrivateAdapterHealth(current, { referenceTime })
  assert.ok(health.missingSourceKinds.includes('plus:product'))
  assert.equal(health.sixShapeCoverageComplete, false)
  assert.throws(() => review(archived, current), /Private retailer fact change review refused/)
})
