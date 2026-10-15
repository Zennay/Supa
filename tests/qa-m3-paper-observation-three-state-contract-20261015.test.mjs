import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildObservationSheet, withObservedProductAvailability,
  observationSheetProgress, observationSheetReadiness,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Independent human-paper-to-canonical-input contract. This is synthetic
// only: no human field evidence, real prices, retailer calls or savings rights.
function fictionalUnavailableWeek() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'paper-three-state-qa',
    participantKey: 'fictional-student',
    population: 'synthetic testers',
    region: 'synthetic region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, date, store] of [
    ['baseline', '2026-10-14T11:00:00Z', 'PLUS'],
    ['candidate', '2026-10-14T12:00:00Z', 'DekaMarkt'],
  ]) {
    const source = sheet[side]
    source.evidenceId = 'fictional-' + side
    source.observedAt = date
    source.provenanceNote = 'not genuine retail evidence'
    source.store.id = 'synthetic-' + side
    source.store.name = store
    source.lines.forEach(line => {
      line.observedProduct = withObservedProductAvailability(line.observedProduct, false)
    })
  }
  return sheet
}
function assertUnresolvedOnly(study) {
  for (const side of ['baseline', 'candidate']) {
    assert.equal(study[side].basket.lines.length, 11)
    assert.equal(study[side].basket.totalCents, 0)
    assert.equal(study[side].basket.matchedLineCount, 0)
    assert.equal(study[side].basket.unresolvedLineCount, 11)
    assert.ok(study[side].basket.lines.every(line => line.status === 'unresolved'))
  }
}

test('M3 physical PLUS/Deka paper rows map exactly to canonical 22 demands and all three choices', () => {
  const html = renderM3PaperChecklist()
  const requirements = buildObservationSheet().requirements
  const sectionPattern = /<section class="page" data-m3-side="(baseline|candidate)">([\s\S]*?)<\/section>/g
  const sections = [...html.matchAll(sectionPattern)]
  assert.deepEqual(sections.map(match => match[1]), ['baseline', 'candidate'])
  for (const [, side, section] of sections) {
    const rows = [...section.matchAll(/<tr data-m3-row="(\d+)">([\s\S]*?)<\/tr>/g)]
    assert.equal(rows.length, 11, side)
    for (let i = 0; i < 11; i++) {
      const row = rows[i]
      const demand = requirements[i]
      assert.equal(Number(row[1]), i + 1)
      assert.ok(row[2].includes(demand.label), 'canonical ' + side + ' demand ' + i)
      assert.equal((row[2].match(/☐ ja ☐ nee ☐ onbekend/g) || []).length, 1)
      assert.equal((row[2].match(/<td/g) || []).length, 6)
      assert.doesNotMatch(row[2], /€\s*\d+[.,]\d{2}/)
    }
  }
  assert.equal((html.match(/niet gecontroleerd/g) || []).length >= 2, true)
  assert.doesNotMatch(html, /<script\b/i)
})

test('M3 checked unavailable (nee) is complete observation but never resolved price or savings', () => {
  const sheet = fictionalUnavailableWeek()
  const progress = observationSheetProgress(sheet)
  assert.equal(progress.completeLines, 22)
  assert.equal(progress.availabilityRecorded, 22)
  assert.equal(observationSheetReadiness(sheet).ready, true)
  const converted = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assertUnresolvedOnly(converted)
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)
  assert.equal(observationSheetProgress(restored).completeLines, 22)
  assertUnresolvedOnly(buildWeeklyBasketStudyFromObservationSheet(restored))
})

test('M3 unchecked unknown (null) in either paper store cannot masquerade as checked unavailable', () => {
  for (const side of ['baseline', 'candidate']) {
    const sheet = fictionalUnavailableWeek()
    sheet[side].lines[6].observedProduct.available = null
    const progress = observationSheetProgress(sheet)
    assert.equal(progress.completeLines, 21)
    assert.equal(progress.availabilityRecorded, 21)
    const status = observationSheetReadiness(sheet)
    assert.equal(status.ready, false)
    assert.match(status.issues.join(' '), /beschikbaarheid is nog niet gemeten/i)
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /available must be true or false/,
    )
    const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
    assert.ok(restored)
    assert.equal(restored[side].lines[6].observedProduct.available, null)
    assert.equal(observationSheetProgress(restored).completeLines, 21)
  }
})

test('M3 checked available (ja) without actual observed product and price remains incomplete', () => {
  const sheet = fictionalUnavailableWeek()
  const target = sheet.baseline.lines[0]
  target.observedProduct = withObservedProductAvailability(target.observedProduct, true)
  const progress = observationSheetProgress(sheet)
  assert.equal(progress.availabilityRecorded, 22)
  assert.equal(progress.completeLines, 21)
  assert.equal(observationSheetReadiness(sheet).ready, false)
  // Converter may classify a partial checked-available line as unresolved,
  // but that must never turn an unpriced product into monetary evidence.
  const converted = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assertUnresolvedOnly(converted)
  assert.equal(converted.baseline.basket.lines[0].status, 'unresolved')
})

test('M3 toggling from ja to unknown/nee must erase stale product identity and cents', () => {
  const sheet = fictionalUnavailableWeek()
  const current = sheet.baseline.lines[2]
  const madeUp = {
    ...current.observedProduct, available: true,
    productName: 'synthetic-seed-not-real',
    productId: 'synthetic-id',
    priceCents: 359,
    packAmount: 1, packUnit: 'piece', packCount: 1,
    sourceUrl: 'internal-fixture-only',
  }
  for (const available of [false, null]) {
    current.observedProduct = withObservedProductAvailability(madeUp, available)
    assert.equal(current.observedProduct.available, available)
    assert.equal(current.observedProduct.priceCents, null)
    assert.equal(current.observedProduct.productId, '')
    assert.equal(current.observedProduct.productName, '')
    assert.equal(current.observedProduct.sourceUrl, '')
    const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
    assert.ok(restored)
    assert.equal(restored.baseline.lines[2].observedProduct.priceCents, null)
    if (available === null) {
      assert.equal(observationSheetProgress(restored).completeLines, 21)
    } else {
      assert.equal(observationSheetProgress(restored).completeLines, 22)
      assertUnresolvedOnly(buildWeeklyBasketStudyFromObservationSheet(restored))
    }
  }
})
