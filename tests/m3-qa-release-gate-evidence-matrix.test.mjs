import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import {
  buildWeeklyBasketStudyFromObservationSheet,
  main as convertObservationSheet,
} from '../scripts/m3-build-observed-study.mjs'
import {
  buildObservedWeekReport,
  main as assessObservedWeek,
} from '../scripts/m3-assess-observed-week.mjs'
import {
  buildBetaSessionSummary,
  validateBetaSession,
} from '../scripts/m4-validate-beta-session.mjs'

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

test('M3 gate: separate source, derived study and report preserve input bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-evidence-gate-'))
  const source = join(directory, 'synthetic-sheet.json')
  const studyFile = join(directory, 'derived-study.json')
  const reportFile = join(directory, 'derived-report.json')
  const original = JSON.stringify(syntheticSheet(), null, 2) + '\n'
  try {
    await writeFile(source, original, { encoding: 'utf8', mode: 0o600 })
    await convertObservationSheet([source, '--output', studyFile])
    const studyBytes = await readFile(studyFile, 'utf8')
    await assessObservedWeek([studyFile, '--output', reportFile])
    const report = JSON.parse(await readFile(reportFile, 'utf8'))
    assert.equal(await readFile(source, 'utf8'), original)
    assert.equal(await readFile(studyFile, 'utf8'), studyBytes)
    assert.notEqual(source, studyFile)
    assert.notEqual(studyFile, reportFile)
    assertNoPublicMoneyClaim(report)
    assert.equal(JSON.stringify(report).includes('synthetic-participant-001'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M4 gate: fictional closed-gate parser summary still suppresses private identities', () => {
  // Purely synthetic parser test. A manually supplied "closed" string is NOT
  // evidence of M3 human completion and must never authorize a real beta.
  const key = 'synthetic-private-key-009'
  const session = {
    schemaVersion: 1,
    sessionType: 'm4-private-beta-session',
    sessionId: 'synthetic-summary-session',
    participantKey: key,
    population: 'fictional validation cohort',
    sessionOutcome: 'unknown',
    consent: { researchConsent: true, allowsAnonymizedQuotes: false },
    m3Gate: { status: 'closed', evidenceRef: 'synthetic-parser-contract-only' },
    startedAt: '2026-10-06T10:00:00Z',
    endedAt: '2026-10-06T10:01:00Z',
    events: [{
      type: 'beta_session_started',
      timestamp: '2026-10-06T10:00:00Z',
      participant_id: key,
      study_week_id: 'synthetic-week',
    }],
  }
  const summary = buildBetaSessionSummary(session)
  assert.equal(summary.sessionOutcome, 'unknown')
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(summary.participantKeyIncluded, false)
  assert.equal('participantKey' in summary, false)
  assert.equal(JSON.stringify(summary).includes(key), false)
  assert.equal(summary.supaPlanningDurationSeconds, null)
  assert.equal(summary.basketOutcome, 'unknown')
})


function fullyPricedSyntheticSheet(candidateOffsetCents) {
  const sheet = syntheticSheet()
  for (const side of ['baseline', 'candidate']) {
    const offset = side === 'candidate' ? candidateOffsetCents : 0
    sheet[side].lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: `${side}-synthetic-product-${index}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + offset,
        sourceUrl: '',
        note: 'Fictional QA value; never a measured retail price.',
      }
    })
  }
  return sheet
}

test('M3 gate: better, same and worse synthetic full baskets never authorize public savings', () => {
  const expected = [
    [-5, 'better'],
    [0, 'same'],
    [5, 'worse'],
  ]
  for (const [difference, expectedOutcome] of expected) {
    const sheet = fullyPricedSyntheticSheet(difference)
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    assert.equal(study.baseline.basket.matchedLineCount, 11)
    assert.equal(study.candidate.basket.matchedLineCount, 11)
    assert.equal(study.baseline.basket.unresolvedLineCount, 0)
    assert.equal(study.candidate.basket.unresolvedLineCount, 0)
    const report = buildObservedWeekReport(study)
    assert.equal(report.outcome, expectedOutcome)
    assert.equal(report.claimable, true) // Study-comparable only; not public claim approval.
    assert.equal(report.deltaCents, difference * 11)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal('participantKey' in report, false)
    assert.equal(JSON.stringify(report).includes(study.participantKey), false)
    assert.notEqual(study.baseline.evidenceId, study.candidate.evidenceId)
    if (difference > 0) assert.ok(report.savingsCents < 0)
    if (difference === 0) assert.equal(report.savingsCents, 0)
    if (difference < 0) assert.ok(report.savingsCents > 0)
  }
})
