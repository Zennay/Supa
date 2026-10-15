import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import {
  buildObservedWeekReport,
  validateObservedWeekInput,
} from '../scripts/m3-assess-observed-week.mjs'

// Contract proposal for #205: one canonical source revision SHA, never inferred.
// All observations and labels below are synthetically generated for QA only.
const PIN = '22edb59b7c96311b686161b74a9fc2060e3c5d77'

function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-revision-001',
    participantKey: 'synthetic-student-001',
    population: 'test-only students',
    region: 'test-region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    fieldRunCommitSha: PIN,
  })
  for (const [side, retailer, storeId] of [
    ['baseline', 'PLUS synthetic store', 'test-plus'],
    ['candidate', 'DekaMarkt synthetic store', 'test-deka'],
  ]) {
    const store = sheet[side]
    store.evidenceId = `${side}-revision-001`
    store.observedAt = side === 'baseline'
      ? '2026-10-07T12:00:00Z'
      : '2026-10-07T13:00:00Z'
    store.source = 'manual-cart'
    store.provenanceNote = 'Synthetic test-only provenance, not field evidence'
    store.store.id = storeId
    store.store.name = retailer
    store.lines.forEach((line) => {
      line.observedProduct.available = false
    })
  }
  return sheet
}

test('M3 converter retains a canonical 40-hex source revision without mutating the input', () => {
  const sheet = syntheticSheet()
  const before = JSON.stringify(sheet)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)

  assert.equal(study.fieldRunCommitSha, PIN)
  assert.equal(JSON.stringify(sheet), before)
  assert.equal(study.baseline.basket.unresolvedLineCount, 11)
  assert.equal(study.candidate.basket.unresolvedLineCount, 11)
})

test('M3 converted study and privacy-safe report carry the identical field-run revision', () => {
  const sheet = syntheticSheet()
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)

  assert.equal(study.fieldRunCommitSha, PIN)
  assert.equal(report.fieldRunCommitSha, PIN)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.outcome, 'unknown')
})

test('M3 converter rejects missing, malformed, or ambiguous collection source revisions', () => {
  for (const invalid of [
    undefined,
    null,
    '',
    '123456',
    PIN.slice(1),
    PIN + '0',
    PIN.toUpperCase(),
    PIN.replace('2', 'g'),
    ` ${PIN}`,
    `${PIN} `,
    { sha: PIN },
    [PIN],
  ]) {
    const sheet = syntheticSheet()
    if (invalid === undefined) {
      delete sheet.study.fieldRunCommitSha
    } else {
      sheet.study.fieldRunCommitSha = invalid
    }

    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /fieldRunCommitSha|revision|source commit/i,
      `reject malformed field-run SHA: ${JSON.stringify(invalid)}`,
    )
  }
})

test('M3 direct report intake rejects missing or invalid revision pins after conversion', () => {
  const study = buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
  for (const invalid of [undefined, null, '', 'bad-sha', PIN.toUpperCase()]) {
    const candidate = structuredClone(study)
    if (invalid === undefined) {
      delete candidate.fieldRunCommitSha
    } else {
      candidate.fieldRunCommitSha = invalid
    }
    const previous = JSON.stringify(candidate)
    assert.throws(
      () => validateObservedWeekInput(candidate),
      /fieldRunCommitSha|revision|source commit/i,
      `reject malformed converted SHA: ${JSON.stringify(invalid)}`,
    )
    assert.equal(JSON.stringify(candidate), previous)
  }
})
