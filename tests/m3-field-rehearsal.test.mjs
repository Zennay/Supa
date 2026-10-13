import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildFictionalRehearsalSheet,
  buildFictionalPricedSheet,
  rehearseM3FieldPipeline,
} from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const script = fileURLToPath(new URL('../scripts/m3-rehearse-field-run.mjs', import.meta.url))

function reportFor(sheet) {
  return buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
}

test('M3 rehearsal runs real converter + assessor with strict fail-closed negative controls', () => {
  assert.deepEqual(rehearseM3FieldPipeline(), {
    kind: 'm3-field-pipeline-rehearsal',
    syntheticOnly: true,
    requirementPairsChecked: 11,
    fictionalOutcomesVerified: ['better', 'same', 'worse', 'unknown'],
    negativeControlsPassed: 7,
    converterAndAssessorOperational: true,
    realRetailerEvidenceVerified: false,
    m3ExitProven: false,
    publicSavingsClaimEligible: false,
    m4BetaEligible: false,
  })
})

test('fictional 11+11 unavailable requirements retain unknown/null savings, never price claims', () => {
  const sheet = buildFictionalRehearsalSheet()
  const source = JSON.stringify(sheet)
  const report = reportFor(sheet)
  assert.equal(JSON.stringify(sheet), source)
  assert.deepEqual(sheet.baseline.lines.map((line) => line.ingredientId),
    sheet.candidate.lines.map((line) => line.ingredientId))
  assert.ok(sheet.baseline.lines.every((line) => line.observedProduct.available === false))
  assert.ok(sheet.candidate.lines.every((line) => line.observedProduct.available === false))
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.claimable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.baseline.matchedLineCount, 0)
  assert.equal(report.candidate.unresolvedLineCount, 11)
})

test('fully priced fictional same-demand baskets exercise genuine converter better/same/worse branches', () => {
  for (const [priceCents, expectedOutcome, expectedSavings] of [
    [90, 'better', 110],
    [100, 'same', 0],
    [110, 'worse', -110],
  ]) {
    const sheet = buildFictionalPricedSheet(priceCents)
    const report = reportFor(sheet)
    assert.equal(report.outcome, expectedOutcome)
    assert.equal(report.baseline.matchedLineCount, 11)
    assert.equal(report.candidate.matchedLineCount, 11)
    assert.equal(report.baselineTotalCents, 1100)
    assert.equal(report.candidateTotalCents, 11 * priceCents)
    assert.equal(report.savingsCents, expectedSavings)
    assert.equal(report.publicSavingsClaimEligible, false)
  }
})

test('fictional complete+expired and partial price studies never leak savings claims', () => {
  const expired = buildFictionalPricedSheet()
  expired.candidate.observedAt = '2026-10-02T10:00:01Z'
  const expiredReport = reportFor(expired)
  assert.equal(expiredReport.outcome, 'unknown')
  assert.equal(expiredReport.savingsCents, null)
  assert.equal(expiredReport.publicSavingsClaimEligible, false)

  const partial = buildFictionalPricedSheet()
  partial.candidate.lines[0].observedProduct.available = false
  const partialReport = reportFor(partial)
  assert.equal(partialReport.outcome, 'unknown')
  assert.equal(partialReport.savingsCents, null)
  assert.equal(partialReport.publicSavingsClaimEligible, false)
})

test('unfinished availability remains invalid, not invented unavailability', () => {
  const sheet = buildFictionalRehearsalSheet()
  sheet.candidate.lines[10].observedProduct.available = null
  assert.throws(() => reportFor(sheet), /available must be true or false/)
})

test('rehearsal rejects tampered demand and switched retailer before report generation', () => {
  const changed = buildFictionalRehearsalSheet()
  changed.baseline.lines[1].requirement.amount += 1
  assert.throws(() => reportFor(changed), /canonical planner demand/)
  const wrongStore = buildFictionalRehearsalSheet()
  wrongStore.candidate.store.name = 'PLUS'
  assert.throws(() => reportFor(wrongStore), /DekaMarkt/)
})

test('fixed UTC instant supports inclusive 24h boundary, refuses 24h+1s as comparable', () => {
  const exact = buildFictionalRehearsalSheet()
  exact.candidate.observedAt = '2026-10-02T10:00:00Z'
  const exactReport = reportFor(exact)
  assert.equal(exactReport.observationWindowHours, 24)
  assert.equal(exactReport.savingsCents, null)
  assert.ok(!exactReport.reasons.some((r) => r.includes('max is 24h')))
  const over = buildFictionalRehearsalSheet()
  over.candidate.observedAt = '2026-10-02T10:00:01Z'
  const overReport = reportFor(over)
  assert.ok(overReport.reasons.some((r) => r.includes('max is 24h')))
  assert.equal(overReport.publicSavingsClaimEligible, false)
})

test('no human file inputs, files created, personal markers or money leave stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-rehearsal-'))
  try {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', script], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stderr, '')
    assert.deepEqual(readdirSync(dir), [])
    const result = JSON.parse(run.stdout)
    assert.equal(result.syntheticOnly, true)
    assert.equal(result.m3ExitProven, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.doesNotMatch(run.stdout, /participantKey|fictional-operator-key|priceCents|provenance|observedAt|savingsCents|studyId/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI refuses all input paths and output flags, sanitizing errors', () => {
  for (const arg of ['private-observations.json', '--output']) {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', script, arg], {
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.notEqual(run.status, 0)
    assert.equal(run.stdout, '')
    assert.equal(run.stderr, 'M3 synthetic rehearsal failed; no field evidence was processed.\n')
  }
})
