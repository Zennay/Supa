import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Separate property from financial claim: private operator and product references
// must not surface in the aggregate-only M3 assessment, including all 22 rows.
// These identifiers and all prices are invented locally for this regression.
test('QA M3 22x3: matched private participant, provenance and source product canaries never appear in the report', () => {
  let checked = 0
  for (const candidatePrice of [90, 100, 110]) {
    for (const side of ['baseline', 'candidate']) {
      for (let index = 0; index < 11; index++) {
        const sheet = buildFictionalPricedSheet(candidatePrice)
        const privateParticipant = `qa-hidden-person-${candidatePrice}-${side}-${index}`
        const privateProvenance = `qa-hidden-note-${candidatePrice}-${side}-${index}`
        const privateSourceProduct = `qa-hidden-product-${candidatePrice}-${side}-${index}`
        sheet.study.participantKey = privateParticipant
        sheet[side].provenanceNote = privateProvenance
        sheet[side].lines[index].observedProduct.productId = privateSourceProduct
        const original = JSON.stringify(sheet)
        const converted = buildWeeklyBasketStudyFromObservationSheet(sheet)
        assert.equal(converted[side].basket.lines[index].productId, privateSourceProduct)
        const report = buildObservedWeekReport(converted)
        const reportBytes = JSON.stringify(report)
        const label = `${side} line ${index} candidate-price ${candidatePrice}`
        for (const canary of [privateParticipant, privateProvenance, privateSourceProduct]) {
          assert.equal(reportBytes.includes(canary), false, label)
        }
        assert.equal(Object.hasOwn(report, 'participantKey'), false, label)
        assert.equal(report.publicSavingsClaimEligible, false, label)
        assert.equal(report[side].matchedLineCount, 11, label)
        assert.equal(JSON.stringify(sheet), original, label)
        checked++
      }
    }
  }
  assert.equal(checked, 66)
})

test('QA M3 22x3: invalid stale private product identifiers never appear in unresolved aggregate money reports', () => {
  let checked = 0
  for (const candidatePrice of [90, 100, 110]) {
    for (const side of ['baseline', 'candidate']) {
      for (let index = 0; index < 11; index++) {
        const sheet = buildFictionalPricedSheet(candidatePrice)
        const canary = `qa-private-unavailable-product-${candidatePrice}-${side}-${index}`
        sheet[side].lines[index].observedProduct.available = false
        sheet[side].lines[index].observedProduct.productId = canary
        sheet[side].lines[index].observedProduct.priceCents = 888888
        const original = JSON.stringify(sheet)
        const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
        assert.equal(report.claimable, false)
        assert.equal(report.outcome, 'unknown')
        assert.equal(report.deltaCents, null)
        assert.equal(report.savingsCents, null)
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal(JSON.stringify(report).includes(canary), false)
        assert.equal(JSON.stringify(report).includes('888888'), false)
        assert.equal(JSON.stringify(sheet), original)
        checked++
      }
    }
  }
  assert.equal(checked, 66)
})
