import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// The exact canonical 11x2 demand is exercised with synthetic prices only.
// This is NOT a genuine field observation, retailer permission or savings proof.
const SIDES = ['baseline', 'candidate']
const OUTCOMES = [
  [90, 'better'],
  [100, 'same'],
  [110, 'worse'],
]

function assess(sheet) {
  return buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
}

test('QA M3 22-line control: all three truthful private outcomes have zero public-claim eligibility', () => {
  for (const [candidatePrice, outcome] of OUTCOMES) {
    const sheet = buildFictionalPricedSheet(candidatePrice)
    const before = JSON.stringify(sheet)
    const report = assess(sheet)
    assert.equal(report.outcome, outcome)
    assert.equal(report.claimable, true)
    assert.equal(report.baseline.matchedLineCount, 11)
    assert.equal(report.candidate.matchedLineCount, 11)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(JSON.stringify(sheet), before, 'assessment must not mutate human intake')
  }
})

test('QA M3 exhaustive 22x3: unavailable line with contradictory stale price never supports a financial claim', () => {
  let checked = 0
  for (const [candidatePrice] of OUTCOMES) {
    for (const side of SIDES) {
      for (let index = 0; index < 11; index++) {
        const sheet = buildFictionalPricedSheet(candidatePrice)
        const row = sheet[side].lines[index]
        row.observedProduct.available = false
        row.observedProduct.priceCents = 900000001 // deliberately retained stale fiction
        const original = JSON.stringify(sheet)
        const report = assess(sheet)
        const label = `${side} row ${index} price ${candidatePrice}`
        assert.equal(report.outcome, 'unknown', label)
        assert.equal(report.claimable, false, label)
        assert.equal(report.savingsCents, null, label)
        assert.equal(report.deltaCents, null, label)
        assert.equal(report.publicSavingsClaimEligible, false, label)
        assert.equal(report[side].matchedLineCount, 10, label)
        assert.equal(report[side].unresolvedLineCount, 1, label)
        assert.equal(JSON.stringify(sheet), original, label)
        checked++
      }
    }
  }
  assert.equal(checked, 66)
})

test('QA M3 exhaustive 22x3: an unmeasured formerly priced line fails before report generation', () => {
  let checked = 0
  for (const [candidatePrice] of OUTCOMES) {
    for (const side of SIDES) {
      for (let index = 0; index < 11; index++) {
        const sheet = buildFictionalPricedSheet(candidatePrice)
        sheet[side].lines[index].observedProduct.available = null
        const original = JSON.stringify(sheet)
        assert.throws(
          () => assess(sheet),
          /available must be true or false/,
          `${side} row ${index} price ${candidatePrice}`,
        )
        assert.equal(JSON.stringify(sheet), original)
        checked++
      }
    }
  }
  assert.equal(checked, 66)
})

test('QA M3 exhaustive 22x3: replacing one ingredient id with another valid row fails canonical demand', () => {
  let checked = 0
  for (const [candidatePrice] of OUTCOMES) {
    for (const side of SIDES) {
      for (let index = 0; index < 11; index++) {
        const sheet = buildFictionalPricedSheet(candidatePrice)
        const next = (index + 1) % 11
        sheet[side].lines[index].ingredientId = sheet.requirements[next].id
        const original = JSON.stringify(sheet)
        assert.throws(
          () => assess(sheet),
          /ingredientId must remain/,
          `${side} row ${index} price ${candidatePrice}`,
        )
        assert.equal(JSON.stringify(sheet), original)
        checked++
      }
    }
  }
  assert.equal(checked, 66)
})

test('QA M3 all 11 rows: permuting ONLY one retailer side never silently reassigns prices to other ingredients', () => {
  let checked = 0
  for (const side of SIDES) {
    for (let shift = 1; shift < 11; shift++) {
      const sheet = buildFictionalPricedSheet()
      sheet[side].lines = [
        ...sheet[side].lines.slice(shift),
        ...sheet[side].lines.slice(0, shift),
      ]
      const original = JSON.stringify(sheet)
      assert.throws(() => assess(sheet), /ingredientId must remain/)
      assert.equal(JSON.stringify(sheet), original)
      checked++
    }
  }
  assert.equal(checked, 20)
})
