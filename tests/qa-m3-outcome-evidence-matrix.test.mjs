import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Deliberately fictional values: this is neither a retailer observation nor an M3 exit artifact.
function syntheticSheet(priceContext, priceDelta) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-outcome-matrix-2026',
    participantKey: 'qa-synthetic-001',
    population: 'synthetic-test-only',
    region: 'fictional-region',
    weekStart: '2026-10-05',
    priceContext,
  })

  for (const [side, storeId, storeName] of [
    ['baseline', 'qa-plus-store', 'PLUS QA synthetic'],
    ['candidate', 'qa-deka-store', 'DekaMarkt QA synthetic'],
  ]) {
    const observation = sheet[side]
    Object.assign(observation, {
      evidenceId: `qa-${side}-fictional`,
      observedAt: side === 'baseline'
        ? '2026-10-06T10:00:00+02:00'
        : '2026-10-06T10:30:00+02:00',
      source: 'manual-cart',
      provenanceNote: 'FICTIONAL TEST DATA — no human visit, receipt or retailer price.',
      store: { id: storeId, name: storeName },
    })

    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: `${storeId}-${requirement.id}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 200 + index + (side === 'candidate' ? priceDelta : 0),
        available: true,
        sourceUrl: '',
        note: 'FICTIONAL TEST PRICE',
      }
    })
  }

  return sheet
}

for (const priceContext of ['in-store', 'online-order']) {
  for (const { label, priceDelta, expectedOutcome, expectedDelta } of [
    { label: 'cheaper', priceDelta: -1, expectedOutcome: 'better', expectedDelta: -11 },
    { label: 'equal', priceDelta: 0, expectedOutcome: 'same', expectedDelta: 0 },
    { label: 'more expensive', priceDelta: 1, expectedOutcome: 'worse', expectedDelta: 11 },
  ]) {
    test(`M3 ${priceContext} ${label}: converter and assessor preserve signed cents but forbid public claim`, () => {
      const study = buildWeeklyBasketStudyFromObservationSheet(
        syntheticSheet(priceContext, priceDelta),
      )
      const report = buildObservedWeekReport(study)

      assert.equal(study.baseline.basket.unresolvedLineCount, 0)
      assert.equal(study.candidate.basket.unresolvedLineCount, 0)
      assert.equal(report.priceContext, priceContext)
      assert.equal(report.claimable, true)
      assert.equal(report.outcome, expectedOutcome)
      assert.equal(report.deltaCents, expectedDelta)
      assert.equal(report.savingsCents, -expectedDelta)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.match(report.evidenceBoundary, /never sufficient/i)
      assert.equal(report.observationWindowHours, 0.5)
      assert.equal('participantKey' in report, false)
      assert.doesNotMatch(JSON.stringify(report), /qa-synthetic-001/)
    })
  }

  test(`M3 ${priceContext}: one unobserved item stays unknown without money or a public claim`, () => {
    const sheet = syntheticSheet(priceContext, -1)
    sheet.candidate.lines[0].observedProduct.available = false
    const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))

    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.match(report.reasons.join(' '), /unresolved ingredients/i)
    assert.equal('participantKey' in report, false)
  })
}

for (const side of ['baseline', 'candidate']) {
  for (const condition of ['explicitly unavailable with stale price', 'available but price missing']) {
    test(`M3 ${side}: ${condition} never becomes an inferred zero-price saving`, () => {
      const sheet = syntheticSheet('in-store', -1)
      const product = sheet[side].lines[0].observedProduct

      if (condition === 'explicitly unavailable with stale price') {
        product.available = false
        // A saved value must never override explicit unavailability.
        assert.equal(typeof product.priceCents, 'number')
      } else {
        product.priceCents = null
        assert.equal(product.available, true)
      }

      const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
      const report = buildObservedWeekReport(study)

      assert.equal(study[side].basket.unresolvedLineCount, 1)
      assert.equal(report.claimable, false)
      assert.equal(report.outcome, 'unknown')
      assert.equal(report.deltaCents, null)
      assert.equal(report.savingsCents, null)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.match(report.reasons.join(' '), /unresolved ingredients/i)
    })
  }
}
