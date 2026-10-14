import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  M3_EXPECTED_RETAILERS,
  observationLineCollectionComplete,
  observationSheetProgress,
  observationSheetReadiness,
  restoreObservationSheetDraft,
  withObservedProductAvailability,
} from '../src/domain/m3ObservationSheet.ts'
import { renderM3FieldVisitCard } from '../src/domain/m3FieldVisitCard.ts'
import { observationRetailerCopy } from '../src/features/observation/observationPresentation.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

const NOW = Date.parse('2026-10-14T18:30:00Z')
const trustedPack = (index) => ({
  productId: `fictional-product-${index}`,
  productName: `Fictief winkelproduct ${index}`,
  packAmount: 500,
  packUnit: 'g',
  packCount: 1,
  priceCents: 129 + index,
  available: true,
  sourceUrl: '',
  note: 'Entirely fictional QA values; not retailer evidence.',
})
function completeFictionalSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-crosspath-availability-only',
    participantKey: 'fictional-participant',
    population: 'fictional-only',
    region: 'fictional-region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, name, instant] of [
    ['baseline', 'PLUS Fictional QA Store', '2026-10-14T12:00:00Z'],
    ['candidate', 'DekaMarkt Fictional QA Store', '2026-10-14T13:00:00Z'],
  ]) {
    const store = sheet[side]
    Object.assign(store, {
      evidenceId: `fictional-${side}-capture`,
      observedAt: instant,
      source: 'manual-cart',
      provenanceNote: 'Only synthetic test data; never field evidence.',
      store: { id: `qa-${side}`, name },
    })
    store.lines.forEach((line, index) => {
      line.observedProduct = trustedPack(index)
    })
  }
  return sheet
}

test('independent QA: routed operator instructions and paper card agree on retailer, demand, timing and no-evidence status', () => {
  const sheet = buildObservationSheet()
  assert.equal(sheet.requirements.length, 11)
  const fullCard = renderM3FieldVisitCard()
  assert.match(fullCard, /GEEN bewijs/)
  assert.match(fullCard, /binnen maximaal 24 uur/)
  assert.match(fullCard, /Kies ÉÉN prijscontext/)
  assert.match(fullCard, /onbekend = nog niet gemeten/)
  assert.match(fullCard, /niet verkrijgbaar = werkelijk als afwezig gezien/i)
  assert.doesNotMatch(fullCard, /€\s*\d+|\bEUR\s*\d+/)
  for (const side of ['baseline', 'candidate']) {
    const expectedRetailer = M3_EXPECTED_RETAILERS[side]
    const copy = observationRetailerCopy(side)
    const card = renderM3FieldVisitCard(side)
    assert.equal(copy.expectedRetailer, expectedRetailer)
    assert.ok(copy.eyebrow.includes(expectedRetailer))
    assert.ok(copy.guidance.includes(expectedRetailer))
    assert.match(copy.guidance, /dezelfde ingrediënten en hoeveelheden/)
    assert.match(copy.guidance, /prijscontext/)
    assert.match(copy.guidance, /tijdzone/)
    assert.match(copy.guidance, /Onbekend is niet hetzelfde als niet beschikbaar/)
    assert.ok(card.includes(`## ${expectedRetailer} —`))
    assert.equal((card.match(/^\s+Verkrijgbaar: \[ \] ja  \[ \] nee  \[ \] onbekend/gm) ?? []).length, 11)
    for (const [index, requirement] of sheet.requirements.entries()) {
      const unit = requirement.unit === 'piece'
        ? (requirement.amount === 1 ? 'stuk' : 'stuks')
        : requirement.unit
      assert.ok(card.includes(`${index + 1}. ${requirement.label} — nodig: ${String(requirement.amount).replace('.', ',')} ${unit}`))
    }
  }
  assert.match(observationRetailerCopy('candidate').guidance, /binnen 24 uur/)
})

test('independent QA: observed no is complete; unmeasured unknown is not, and neither retains stale prices', () => {
  const ready = completeFictionalSheet()
  assert.equal(observationSheetReadiness(ready, NOW).ready, true)
  const first = ready.baseline.lines[0]
  assert.equal(observationLineCollectionComplete(first), true)
  const unavailable = withObservedProductAvailability(first.observedProduct, false)
  first.observedProduct = unavailable
  assert.equal(unavailable.available, false)
  for (const field of ['productId', 'productName', 'sourceUrl', 'note']) {
    assert.equal(unavailable[field], '', `stale ${field} must disappear`)
  }
  for (const field of ['packAmount', 'packUnit', 'priceCents']) {
    assert.equal(unavailable[field], null, `stale ${field} must disappear`)
  }
  assert.equal(observationLineCollectionComplete(first), true)
  assert.equal(observationSheetReadiness(ready, NOW).ready, true, 'actually observed unavailable does not mean missing')
  const progress = observationSheetProgress(ready)
  assert.deepEqual([progress.totalLines, progress.availabilityRecorded, progress.completeLines], [22, 22, 22])
  const restored = restoreObservationSheetDraft(JSON.stringify(ready))
  assert.ok(restored)
  assert.equal(restored.baseline.lines[0].observedProduct.available, false)
  assert.equal(restored.baseline.lines[0].observedProduct.priceCents, null)
  assert.equal(observationSheetReadiness(restored, NOW).ready, true)

  first.observedProduct = withObservedProductAvailability(unavailable, null)
  assert.equal(observationLineCollectionComplete(first), false)
  const unknown = observationSheetReadiness(ready, NOW)
  assert.equal(unknown.ready, false)
  assert.ok(unknown.issues.some(issue => /beschikbaarheid is nog niet gemeten/.test(issue)))
  const unknownProgress = observationSheetProgress(ready)
  assert.deepEqual([unknownProgress.totalLines, unknownProgress.availabilityRecorded, unknownProgress.completeLines], [22, 21, 21])
  assert.notEqual(observationNextAction(ready, NOW).stage, 'export')
  const recovered = restoreObservationSheetDraft(JSON.stringify(ready))
  assert.ok(recovered)
  assert.equal(recovered.baseline.lines[0].observedProduct.available, null)
  assert.equal(recovered.baseline.lines[0].observedProduct.priceCents, null)
  assert.equal(observationSheetReadiness(recovered, NOW).ready, false)
})

test('independent QA: true with erased pack/price remains incomplete; toggling no clears private stale values', () => {
  const sheet = completeFictionalSheet()
  const line = sheet.candidate.lines.at(-1)
  assert.ok(line)
  line.observedProduct = withObservedProductAvailability(line.observedProduct, true)
  line.observedProduct.packAmount = null
  line.observedProduct.priceCents = null
  assert.equal(observationLineCollectionComplete(line), false)
  const state = observationSheetReadiness(sheet, NOW)
  assert.equal(state.ready, false)
  assert.ok(state.issues.some(issue => /verpakkingshoeveelheid/.test(issue)))
  assert.ok(state.issues.some(issue => /prijs per verpakking/.test(issue)))
  assert.notEqual(observationNextAction(sheet, NOW).stage, 'export')
  const no = withObservedProductAvailability(line.observedProduct, false)
  line.observedProduct = no
  assert.equal(no.available, false)
  assert.equal(no.productName, '')
  assert.equal(no.priceCents, null)
  assert.equal(observationLineCollectionComplete(line), true)
  assert.equal(observationSheetReadiness(sheet, NOW).ready, true)
})

test('independent QA: official converter and assessor never treat measured-no or unmeasured as savings', () => {
  const observedNo = completeFictionalSheet()
  const index = 3 // fictional cauliflower requirement, never a retailer observation
  const original = observedNo.candidate.lines[index].observedProduct
  observedNo.candidate.lines[index].observedProduct = {
    ...original,
    available: false,
    productName: 'Synthetic stale private value',
    priceCents: 1,
    packAmount: 999,
  }
  // An upstream caller may pass a noncanonical raw JSON object. Even if stale
  // monetary bytes survive in that object, a measured unavailable item is an
  // unresolved ingredient, not a zero/one-cent purchasable product.
  const study = buildWeeklyBasketStudyFromObservationSheet(observedNo)
  const line = study.candidate.basket.lines[index]
  assert.equal(line.status, 'unresolved')
  assert.ok(line.reasons.includes('observed product unavailable'))
  assert.equal(Object.hasOwn(line, 'lineTotalCents'), false)
  assert.equal(Object.hasOwn(line, 'pricePerPackCents'), false)
  const result = assessWeeklyBasketStudy(study, { referenceNowMs: NOW })
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
  assert.equal(result.comparison.deltaCents, null)

  const unmeasured = completeFictionalSheet()
  unmeasured.candidate.lines[index].observedProduct = {
    ...original,
    available: null,
    priceCents: 1,
  }
  assert.equal(observationSheetReadiness(unmeasured, NOW).ready, false)
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(unmeasured),
    /observedProduct.available must be true or false/)
  const safelyRestored = restoreObservationSheetDraft(JSON.stringify(unmeasured))
  assert.ok(safelyRestored)
  assert.equal(safelyRestored.candidate.lines[index].observedProduct.available, null)
  assert.equal(safelyRestored.candidate.lines[index].observedProduct.priceCents, null)
})
