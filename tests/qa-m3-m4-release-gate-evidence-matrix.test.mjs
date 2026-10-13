import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { validateBetaSession } from '../scripts/m4-validate-beta-session.mjs'

// Entirely invented protocol fixtures: this test does not represent a retailer visit.
// Never change these to real prices, field observations, or participant data.
function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-gate-week',
    participantKey: 'synthetic-participant-001',
    population: 'synthetic students',
    region: 'synthetic region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })

  for (const [side, id, name, time] of [
    ['baseline', 'synthetic-plus', 'PLUS synthetic store', '2026-10-06T10:00:00Z'],
    ['candidate', 'synthetic-deka', 'DekaMarkt synthetic store', '2026-10-06T11:00:00Z'],
  ]) {
    const observation = sheet[side]
    observation.store = { id, name }
    observation.evidenceId = `${id}-observation`
    observation.observedAt = time
    observation.source = 'manual-cart'
    observation.provenanceNote = 'SYNTHETIC PRIVATE PROVENANCE TOKEN'
    for (const line of observation.lines) {
      line.observedProduct.available = false
    }
  }
  return sheet
}

function reportFor(sheet) {
  return buildObservedWeekReport(
    buildWeeklyBasketStudyFromObservationSheet(sheet),
  )
}

function assertNoPublicMoneyClaim(report) {
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.attribution.status, 'unknown')
  assert.equal(report.attribution.effectTotals.unknownCents, null)
}

test('M3 gate: a blank availability template cannot masquerade as a completed observation', () => {
  const sheet = syntheticSheet()
  for (const side of ['baseline', 'candidate']) {
    sheet[side].lines[0].observedProduct.available = null
  }
  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /available must be true or false/,
  )
})

test('M3 gate: exactly 11 + 11 synthetic unavailable rows are never counted as measured prices', () => {
  const sheet = syntheticSheet()
  assert.equal(sheet.requirements.length, 11)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  for (const side of ['baseline', 'candidate']) {
    const source = sheet[side]
    const basket = study[side].basket
    assert.equal(source.lines.length, 11)
    assert.deepEqual(
      source.lines.map((line) => line.ingredientId),
      sheet.requirements.map((line) => line.id),
    )
    assert.equal(basket.lines.length, 11)
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 11)
    assert.equal(basket.totalCents, 0) // accounting placeholder, NOT a zero-price basket
    for (const line of basket.lines) {
      assert.equal(line.status, 'unresolved')
      assert.equal(Object.hasOwn(line, 'pricePerPackCents'), false)
      assert.equal(Object.hasOwn(line, 'lineTotalCents'), false)
    }
  }
  assertNoPublicMoneyClaim(buildObservedWeekReport(study))
})

test('M3 gate: prices hidden behind unavailable status never become measured evidence', () => {
  const sheet = syntheticSheet()
  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) {
      Object.assign(line.observedProduct, {
        available: false,
        productName: 'not observed',
        priceCents: 1,
        packAmount: 1,
        packUnit: line.requirement.unit,
        packCount: 1,
      })
    }
  }
  const report = reportFor(sheet)
  assertNoPublicMoneyClaim(report)
  assert.equal(report.baseline.matchedLineCount, 0)
  assert.equal(report.candidate.matchedLineCount, 0)
})

test('M3 gate: partial availability remains unknown and never creates a public saving', () => {
  const sheet = syntheticSheet()
  const row = sheet.candidate.lines[0]
  Object.assign(row.observedProduct, {
    available: true,
    productId: 'synthetic-item',
    productName: sheet.requirements[0].query,
    packAmount: row.requirement.amount,
    packUnit: row.requirement.unit,
    packCount: 1,
    priceCents: 123,
  })
  const report = reportFor(sheet)
  assertNoPublicMoneyClaim(report)
  assert.equal(report.baseline.unresolvedLineCount, 11)
  assert.ok(report.candidate.unresolvedLineCount >= 10)
})

test('M3 gate: public-safe report omits participant identity and private provenance', () => {
  const sheet = syntheticSheet()
  const report = reportFor(sheet)
  const json = JSON.stringify(report)
  assert.equal('participantKey' in report, false)
  assert.equal('provenanceNote' in report.baseline, false)
  assert.equal('provenanceNote' in report.candidate, false)
  assert.equal(json.includes(sheet.study.participantKey), false)
  assert.equal(json.includes(sheet.baseline.provenanceNote), false)
  assert.equal(json.includes(sheet.candidate.provenanceNote), false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('M4 gate: synthetic session cannot pass while genuine M3 evidence is open', () => {
  const session = {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-session',
    participantKey: 'synthetic-participant-001',
    population: 'synthetic students',
    sessionOutcome: 'unknown',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'open', evidenceRef: '' },
    startedAt: '2026-10-06T10:00:00Z',
    endedAt: '2026-10-06T10:01:00Z',
    events: [],
  }
  assert.throws(
    () => validateBetaSession(session),
    /m3Gate.status must be closed before M4 beta data is accepted/,
  )
})
