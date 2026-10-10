import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// Fictitious values and synthetic study IDs only. Not human/retailer evidence.
function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'future-clock-synthetic', participantKey: 'synthetic-student',
    population: 'synthetic-test-only', region: 'synthetic-region',
    weekStart: '2026-09-28', priceContext: 'in-store',
  })
  for (const [side, storeName, storeId, priceOffset, observedAt] of [
    ['baseline', 'PLUS Leiden testfiliaal', 'plus-test', 10, '2026-10-04T12:00:00Z'],
    ['candidate', 'DekaMarkt Leiden testfiliaal', 'deka-test', 0, '2026-10-04T13:00:00Z'],
  ]) {
    const observation = sheet[side]
    Object.assign(observation, {
      evidenceId: side + '-synthetic',
      observedAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic fixture: no actual store was visited.',
    })
    observation.store = { id: storeId, name: storeName }
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: storeId + '-' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + priceOffset,
        available: true,
        sourceUrl: '',
        note: 'Synthetic fixture only.',
      }
    })
  }
  return sheet
}

test('synthetic past M3 study remains convertible and comparable', () => {
  const study = buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
  assert.equal(study.baseline.basket.matchedLineCount, 11)
  assert.equal(study.candidate.basket.matchedLineCount, 11)
  assert.equal(assessWeeklyBasketStudy(study).comparison.outcome, 'better')
})

test('canonical JSON converter rejects future captures for each retailer independently', () => {
  for (const side of ['baseline', 'candidate']) {
    const sheet = syntheticSheet()
    sheet[side].observedAt = '2099-10-10T13:00:00+01:00'
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      new RegExp(side + '\\.observedAt must be a valid timestamp'),
      side,
    )
  }
})

test('canonical JSON converter rejects a pair of future captures inside a 24h window', () => {
  const sheet = syntheticSheet()
  sheet.baseline.observedAt = '2099-10-10T12:00:00Z'
  sheet.candidate.observedAt = '2099-10-10T08:00:00-05:00'
  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /observedAt must be a valid timestamp/,
  )
})

test('direct financial assessment refuses a single future capture even with valid totals', () => {
  for (const side of ['baseline', 'candidate']) {
    const study = buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
    study[side].observedAt = '2099-10-10T12:00:00Z'
    const result = assessWeeklyBasketStudy(study)
    assert.equal(result.claimable, false, side)
    assert.equal(result.comparison.claimable, false, side)
    assert.equal(result.comparison.outcome, 'unknown', side)
    assert.equal(result.comparison.savingsCents, null, side)
  }
})

test('direct financial assessment refuses a wholly future but 1-hour-apart pair', () => {
  const study = buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
  study.baseline.observedAt = '2099-10-10T12:00:00Z'
  study.candidate.observedAt = '2099-10-10T08:00:00-05:00'
  const result = assessWeeklyBasketStudy(study)
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
})
