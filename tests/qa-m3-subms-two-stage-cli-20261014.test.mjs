import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// Independent #1513 QA. Real converter and assessor subprocesses; only
// fictional products/retailers, private temporary files, no live observations.
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))
const first = '2025-10-26T02:30:00.000000000+02:00'

function runPrivateCli(script, input, output, cwd) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, input, '--output', output],
    { cwd, encoding: 'utf8', timeout: 30000 },
  )
  assert.equal(result.status, 0, 'canonical synthetic M3 CLI must succeed')
  assert.equal(result.stdout, '', 'private observations cannot be printed')
  assert.equal(result.stderr, '', 'private observations cannot be logged')
  assert.equal(statSync(output).mode & 0o077, 0, 'derived output must be private')
}

function reportThroughRealCli(second) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-qa-m3-subms-cli-'))
  const sheetFile = join(directory, 'fictional-sheet.json')
  const studyFile = join(directory, 'fictional-study.json')
  const reportFile = join(directory, 'fictional-report.json')
  try {
    const sheet = buildFictionalPricedSheet(90)
    sheet.study.weekStart = '2025-10-27'
    sheet.baseline.observedAt = first
    sheet.candidate.observedAt = second
    const original = JSON.stringify(sheet)
    writeFileSync(sheetFile, original, { mode: 0o600 })
    runPrivateCli(converter, sheetFile, studyFile, directory)
    assert.equal(readFileSync(sheetFile, 'utf8'), original, 'input cannot be rewritten')

    const study = JSON.parse(readFileSync(studyFile, 'utf8'))
    assert.equal(study.baseline.basket.matchedLineCount, 11)
    assert.equal(study.candidate.basket.matchedLineCount, 11)
    runPrivateCli(assessor, studyFile, reportFile, directory)
    const report = JSON.parse(readFileSync(reportFile, 'utf8'))
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
    assert.equal(report.publicSavingsClaimEligible, false)
    return report
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const [label, second] of [
  ['one nanosecond', '2025-10-27T01:30:00.000000001+01:00'],
  ['900 microseconds', '2025-10-27T01:30:00.000900000+01:00'],
]) {
  test(`M3 actual CLI pair must not publish fictional money for 24h plus ${label}`, () => {
    const report = reportThroughRealCli(second)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.savingsCents, null)
    assert.equal(report.deltaCents, null)
  })
}

test('M3 actual private CLI pair keeps exact 24h zero-fraction positive control', () => {
  const report = reportThroughRealCli('2025-10-27T01:30:00.000000000+01:00')
  assert.equal(report.claimable, true, report.reasons.join('; '))
  assert.equal(report.outcome, 'better')
  assert.equal(report.savingsCents, 110)
  assert.equal(report.publicSavingsClaimEligible, false)
})
