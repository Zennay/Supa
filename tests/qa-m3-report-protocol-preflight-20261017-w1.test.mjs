// Independent quality-validation only. All observations below are fictitious,
// explicitly unavailable, and must never be treated as supermarket price evidence.
// The M3 importer and financial assessor already enforce version/calendar validity;
// the public report preflight must not silently downgrade an unsupported protocol
// into a schemaVersion:1 report or create a report for an impossible planned week.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import {
  buildObservedWeekReport,
  validateObservedWeekInput,
} from '../scripts/m3-assess-observed-week.mjs'

function unavailableSyntheticStudy() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-protocol-study-001',
    participantKey: 'fictional-001',
    population: 'fictional qa only',
    region: 'fictional test locality',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, retailer, time] of [
    ['baseline', 'PLUS', '2026-10-16T09:00:00Z'],
    ['candidate', 'DekaMarkt', '2026-10-16T10:00:00Z'],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = `synthetic-${side}-001`
    observation.observedAt = time
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Fictional unavailable products. No observed price.'
    observation.store = { id: `fictional-${side}-shop`, name: retailer }
    for (const line of observation.lines) line.observedProduct.available = false
  }
  return buildWeeklyBasketStudyFromObservationSheet(sheet)
}

test('M3 study protocol: canonical v1, real Gregorian date and no prices remain an unclaimable private report', () => {
  const study = unavailableSyntheticStudy()
  assert.doesNotThrow(() => validateObservedWeekInput(study))
  const report = buildObservedWeekReport(study)
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.claimable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.savingsCents, null)
  assert.equal(report.outcome, 'unknown')
  assert.equal('participantKey' in report, false)
})

test('M3 study protocol: date validator retains real Gregorian leap date', () => {
  const study = unavailableSyntheticStudy()
  study.weekStart = '2024-02-29'
  assert.doesNotThrow(() => validateObservedWeekInput(study))
})

for (const schemaVersion of [0, 2, -1]) {
  test(`M3 report preflight must reject unsupported numeric schemaVersion ${schemaVersion}`, () => {
    const study = unavailableSyntheticStudy()
    study.schemaVersion = schemaVersion
    assert.throws(
      () => validateObservedWeekInput(study),
      /schemaVersion|schema version|unsupported/i,
    )
    assert.throws(
      () => buildObservedWeekReport(study),
      /schemaVersion|schema version|unsupported/i,
    )
  })
}

for (const weekStart of ['2026-02-30', '2026-13-01', '2026-00-01', 'next week', '2026-10-12T00:00:00Z']) {
  test(`M3 report preflight must reject noncanonical Gregorian weekStart ${weekStart}`, () => {
    const study = unavailableSyntheticStudy()
    study.weekStart = weekStart
    assert.throws(
      () => validateObservedWeekInput(study),
      /weekStart|Gregorian|valid date|YYYY-MM-DD/i,
    )
    assert.throws(
      () => buildObservedWeekReport(study),
      /weekStart|Gregorian|valid date|YYYY-MM-DD/i,
    )
  })
}

test('M3 report command refuses an impossible week without creating a derived artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-qa-week-protocol-'))
  try {
    const input = join(directory, 'synthetic-study.json')
    const output = join(directory, 'derived-report.json')
    const study = unavailableSyntheticStudy()
    study.weekStart = '2026-02-30'
    await writeFile(input, JSON.stringify(study), { mode: 0o600 })
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      join(process.cwd(), 'scripts/m3-assess-observed-week.mjs'),
      input, '--output', output,
    ], { encoding: 'utf8', timeout: 30000 })
    assert.notEqual(result.status, 0, 'invalid calendar date must cause nonzero exit')
    assert.equal(existsSync(output), false, 'invalid study must not write a report')
    assert.doesNotMatch(result.stdout, /savingsCents|baselineTotalCents/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
