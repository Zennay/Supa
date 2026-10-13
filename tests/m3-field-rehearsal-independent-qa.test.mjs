import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildFictionalPricedSheet,
  buildFictionalRehearsalSheet,
  rehearseM3FieldPipeline,
} from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const script = fileURLToPath(new URL('../scripts/m3-rehearse-field-run.mjs', import.meta.url))

function assess(sheet) {
  return buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
}

function runCli(cwd, argv = [], timezone = 'UTC') {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...argv], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, TZ: timezone },
  })
}

test('independent cent-sweep preserves fictional better/same/worse signs without public savings', () => {
  // Pricing a complete basket is a calculation test, NEVER observed retailer evidence.
  for (const cents of [1, 50, 75, 99, 100, 101, 125, 175, 999]) {
    const sheet = buildFictionalPricedSheet(cents)
    const before = JSON.stringify(sheet)
    const report = assess(sheet)
    assert.equal(JSON.stringify(sheet), before, `converter mutated source at ${cents} cents`)
    assert.equal(report.baseline.matchedLineCount, 11)
    assert.equal(report.candidate.matchedLineCount, 11)
    assert.equal(report.baselineTotalCents, 1100)
    assert.equal(report.candidateTotalCents, 11 * cents)
    assert.equal(report.savingsCents, 11 * (100 - cents))
    assert.equal(report.outcome, cents < 100 ? 'better' : cents === 100 ? 'same' : 'worse')
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.m4BetaEligible, undefined) // M4 decision is not a property of an M3 study report.
  }
})

test('independent unavailable 11+11 controls remain unknown across fresh constructions', () => {
  for (let replay = 0; replay < 4; replay += 1) {
    const sheet = buildFictionalRehearsalSheet()
    const report = assess(sheet)
    assert.equal(sheet.baseline.lines.length, 11)
    assert.equal(sheet.candidate.lines.length, 11)
    assert.equal(report.baseline.unresolvedLineCount, 11)
    assert.equal(report.candidate.unresolvedLineCount, 11)
    assert.equal(report.baseline.matchedLineCount, 0)
    assert.equal(report.candidate.matchedLineCount, 0)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
  }
})

test('mutating one fictional fixture cannot corrupt the next rehearsal or an independent fixture', () => {
  const tampered = buildFictionalPricedSheet(99)
  tampered.candidate.lines[0].observedProduct.priceCents = 55555
  tampered.study.participantKey = 'qa-poisoned-fixture'
  const fresh = buildFictionalPricedSheet(99)
  assert.equal(fresh.candidate.lines[0].observedProduct.priceCents, 99)
  assert.equal(fresh.study.participantKey, 'fictional-operator-key')
  const report = assess(fresh)
  assert.equal(report.savingsCents, 11)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(rehearseM3FieldPipeline().m3ExitProven, false)
})

test('CLI output is byte-identical in multiple host timezones and has a strict closed disclosure shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-qa-rehearsal-tz-'))
  try {
    let baseline
    const permitted = [
      'converterAndAssessorOperational',
      'fictionalOutcomesVerified',
      'kind',
      'm3ExitProven',
      'm4BetaEligible',
      'negativeControlsPassed',
      'publicSavingsClaimEligible',
      'realRetailerEvidenceVerified',
      'requirementPairsChecked',
      'syntheticOnly',
    ]
    for (const tz of ['UTC', 'Europe/Amsterdam', 'America/New_York', 'Pacific/Auckland']) {
      const run = runCli(dir, [], tz)
      assert.equal(run.status, 0, `${tz}: ${run.stderr}`)
      assert.equal(run.signal, null)
      assert.equal(run.stderr, '')
      assert.match(run.stdout, /^\{[^\n]+\}\n$/)
      const json = JSON.parse(run.stdout)
      assert.deepEqual(Object.keys(json).sort(), permitted.sort())
      assert.deepEqual(json.fictionalOutcomesVerified, ['better', 'same', 'worse', 'unknown'])
      assert.equal(json.syntheticOnly, true)
      assert.equal(json.realRetailerEvidenceVerified, false)
      assert.equal(json.m3ExitProven, false)
      assert.equal(json.publicSavingsClaimEligible, false)
      assert.equal(json.m4BetaEligible, false)
      assert.doesNotMatch(run.stdout, /participant|fictional-operator|evidenceId|provenance|priceCents|savingsCents|observedAt|region|storeId/i)
      baseline ??= run.stdout
      assert.equal(run.stdout, baseline)
    }
    assert.deepEqual(readdirSync(dir), [], 'rehearsal created files in caller working directory')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('all file-like and help CLI arguments fail before overwriting or creating synthetic output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-qa-rehearsal-args-'))
  const canary = join(dir, 'must-not-change.json')
  const expected = Buffer.from('DO NOT REPLACE ME; NOT AN OBSERVATION SHEET\n', 'utf8')
  try {
    writeFileSync(canary, expected, { mode: 0o600 })
    for (const args of [
      [canary],
      ['--input', canary],
      [`--output=${canary}`],
      ['--output', canary],
      ['--help'],
      ['--', canary],
    ]) {
      const result = runCli(dir, args)
      assert.notEqual(result.status, 0, `CLI accepted ${args[0]}`)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr, 'M3 synthetic rehearsal failed; no field evidence was processed.\n')
      assert.deepEqual(readFileSync(canary), expected, 'CLI changed an existing file')
      assert.deepEqual(readdirSync(dir), ['must-not-change.json'], 'CLI created an unexpected file')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
