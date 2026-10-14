import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  assessCoreRetailerCoverage,
  compareCoreRetailerInventories,
} from '../scripts/m5-check-core-retailer-coverage.mjs'

// Entirely offline, research-only frozen original owner JSON. No store HTTP,
// licensed feed, real shopper observation, user data or price/savings claim.
const source = JSON.parse(await readFile(
  new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
const fresh = () => structuredClone(source)
const safelyAlter = (document, id, field, value) => {
  const target = document.sources.find(row => row.id === id)
  assert.ok(target, 'synthetic fixture must contain the named candidate')
  target[field] = value
  return document
}
const secondApprovedCitation =
  'https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten'

function expectResearchOnly(report) {
  for (const key of ['rightsVerified', 'productionReady', 'm5Eligible',
    'historicalEvidenceVerified']) assert.equal(report[key], false)
  assert.deepEqual(report.addedCandidateIds, [])
  assert.deepEqual(report.removedCandidateIds, [])
}
function expectMetadataReview(current, prior) {
  // Upstream owner schema must still accept both complete candidate registers.
  assert.equal(assessCoreRetailerCoverage(current).coreCovered, true)
  assert.equal(assessCoreRetailerCoverage(prior).coreCovered, true)
  const beforeCurrent = structuredClone(current)
  const beforePrior = structuredClone(prior)
  const result = compareCoreRetailerInventories(current, prior)
  expectResearchOnly(result)
  assert.equal(result.coreCovered, true)
  assert.equal(result.changed, true,
    'material candidate metadata drift must not be classified as unchanged')
  assert.equal(result.humanReviewRequired, true,
    'new supplier description or independent evidence needs human review')
  assert.deepEqual(current, beforeCurrent, 'do not rewrite research register')
  assert.deepEqual(prior, beforePrior, 'do not rewrite earlier research register')
}
test('QA control: independently allocated identical research candidate registers produce no false review', () => {
  const r = compareCoreRetailerInventories(fresh(), fresh())
  expectResearchOnly(r)
  assert.equal(r.changed, false)
  assert.equal(r.humanReviewRequired, false)
})
test('QA control: source order is not new retailer evidence or meaningful drift', () => {
  const current = fresh()
  current.sources.reverse()
  const r = compareCoreRetailerInventories(current, fresh())
  expectResearchOnly(r)
  assert.equal(r.changed, false)
  assert.equal(r.humanReviewRequired, false)
})
test('QA control: core coverage always remains research-only', () => {
  const report = assessCoreRetailerCoverage(fresh())
  assert.equal(report.coreCovered, true)
  assert.equal(report.candidateCount, 17)
  assert.equal(report.rightsVerified, false)
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
})
test('QA control: removal of extra banner already receives manual change review', () => {
  const current = fresh()
  current.sources = current.sources.filter(row => row.id !== 'odin')
  const r = compareCoreRetailerInventories(current, fresh())
  assert.deepEqual(r.removedCandidateIds, ['odin'])
  assert.equal(r.changed, true)
  assert.equal(r.humanReviewRequired, true)
  assert.equal(r.rightsVerified, false)
  assert.equal(r.m5Eligible, false)
})
test('QA control: addition of previously absent required banner stays review-only', () => {
  const previous = fresh()
  previous.sources = previous.sources.filter(row => row.id !== 'boni')
  const r = compareCoreRetailerInventories(fresh(), previous)
  assert.deepEqual(r.addedCandidateIds, ['boni'])
  assert.equal(r.humanReviewRequired, true)
  assert.equal(r.historicalEvidenceVerified, false)
  assert.equal(r.productionReady, false)
})
test('QA original RED: changed core PLUS display identity is candidate metadata drift', () => {
  const prior = fresh()
  const current = safelyAlter(fresh(), 'plus', 'name', 'Fictional PLUS label revision')
  expectMetadataReview(current, prior)
})
test('QA original RED: changed additional Odin candidate label is reviewable drift', () => {
  expectMetadataReview(
    safelyAlter(fresh(), 'odin', 'name', 'Fictional Odin label revision'),
    fresh(),
  )
})
test('QA original RED: research citation may change within approved market-list URL set', () => {
  const current = fresh()
  const target = current.sources.find(row => row.id === 'plus')
  assert.notEqual(target.researchUrl, secondApprovedCitation)
  target.researchUrl = secondApprovedCitation
  expectMetadataReview(current, fresh())
})
test('QA original RED: ancillary chain can change its public research citation with identical IDs', () => {
  const current = fresh()
  current.sources.find(row => row.id === 'odin').researchUrl = secondApprovedCitation
  expectMetadataReview(current, fresh())
})
test('QA original RED: simultaneous display-name and citation rebind must be reviewed', () => {
  const current = fresh()
  const target = current.sources.find(row => row.id === 'plus')
  target.name = 'Fictional source provenance rename'
  target.researchUrl = secondApprovedCitation
  expectMetadataReview(current, fresh())
})
test('QA control: same source array pretending to be historical evidence fails closed', () => {
  const current = fresh()
  const prior = { ...current }
  assert.throws(() => compareCoreRetailerInventories(current, prior),
    /Distinct inventory inputs required/)
})
test('QA control: no synthetic metadata edits grant source permissions', () => {
  const altered = safelyAlter(fresh(), 'plus', 'name', 'Fictional name only')
  const r = assessCoreRetailerCoverage(altered)
  assert.equal(r.rightsVerified, false)
  assert.equal(r.productionReady, false)
  assert.equal(r.m5Eligible, false)
})
