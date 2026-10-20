// Synthetic, add-only expected-RED QA for Supa issue #2035.
// Private names here are fictional canary strings. No retailer or participant data.
// This suite tests CLI error-channel privacy; it does not modify CLI owners.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONVERTER = join(ROOT, 'scripts/m3-build-observed-study.mjs')
const ASSESSOR = join(ROOT, 'scripts/m3-assess-observed-week.mjs')
const GENERATOR = join(ROOT, 'scripts/m3-create-observation-sheet.mjs')
const PRIVATE_CANARY = 'SYNTHETIC_PARTICIPANT_DO_NOT_PRINT_13579'

function withScratch(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'supa-cli-error-privacy-'))
  try {
    return callback(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function run(script, input, output) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, input, '--output', output],
    { cwd: ROOT, encoding: 'utf8', timeout: 15000 },
  )
  assert.equal(result.error, undefined, result.error?.message)
  assert.notEqual(result.status, 0, 'unreadable input must fail closed')
  assert.equal(result.stdout, '', 'failed CLI must not write study/report to stdout')
  assert.equal(existsSync(output), false, 'failed CLI must not publish a report')
  return result
}

for (const [label, script] of [
  ['converter', CONVERTER],
  ['assessor', ASSESSOR],
]) {
  test(`M3 ${label}: missing input path containing fictional private participant key is redacted from stderr [expected RED]`, () => {
    withScratch((directory) => {
      const missing = join(directory, PRIVATE_CANARY, 'source.json')
      const report = join(directory, 'report.json')
      const result = run(script, missing, report)
      assert.doesNotMatch(
        result.stderr,
        new RegExp(PRIVATE_CANARY),
        'reading an absent file must not echo a private path/participant key to logs',
      )
    })
  })

  test(`M3 ${label}: ordinary missing input remains a safe non-success without published output [control]`, () => {
    withScratch((directory) => {
      const missing = join(directory, 'unavailable.json')
      const report = join(directory, 'report.json')
      const result = run(script, missing, report)
      assert.match(result.stderr, /could not be read\/parsed/)
      assert.doesNotMatch(result.stderr, /SYNTHETIC_PARTICIPANT_DO_NOT_PRINT/)
    })
  })
}

test('M3 sheet generator: existing private output path must not be echoed on no-clobber rejection [expected RED]', () => {
  withScratch((directory) => {
    const output = join(directory, `${PRIVATE_CANARY}-sheet.json`)
    const original = Buffer.from('FICTIONAL-PRESERVED-BYTES-2468')
    writeFileSync(output, original, { mode: 0o600 })
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', GENERATOR, '--output', output],
      { cwd: ROOT, encoding: 'utf8', timeout: 15000 },
    )
    assert.equal(result.error, undefined, result.error?.message)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.deepEqual(readFileSync(output), original, 'no-clobber must preserve exact original output')
    assert.doesNotMatch(
      result.stderr,
      new RegExp(PRIVATE_CANARY),
      'EEXIST diagnostics must not reveal sensitive field-run sheet path components',
    )
  })
})

test('M3 sheet generator: ordinary existing output is rejected with unchanged bytes [control]', () => {
  withScratch((directory) => {
    const output = join(directory, 'existing-sheet.json')
    const original = Buffer.from('FICTIONAL-PRESERVED-BYTES-2468')
    writeFileSync(output, original, { mode: 0o600 })
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', GENERATOR, '--output', output],
      { cwd: ROOT, encoding: 'utf8', timeout: 15000 },
    )
    assert.equal(result.error, undefined, result.error?.message)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /refusing to overwrite existing observation sheet/)
    assert.deepEqual(readFileSync(output), original)
    assert.doesNotMatch(result.stderr, /SYNTHETIC_PARTICIPANT_DO_NOT_PRINT/)
  })
})

function fictionalUnavailableSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-week-2026-40',
    participantKey: 'synthetic-qa-only',
    population: 'synthetic sample only',
    region: 'fictional-test-region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    const observation = sheet[side]
    observation.evidenceId = `${side}-synthetic-001`
    observation.observedAt = side === 'baseline'
      ? '2026-10-12T12:00:00Z'
      : '2026-10-12T13:00:00Z'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Fictional unavailable-only fixture; NOT retail evidence.'
    observation.store.id = `${side}-synthetic-store`
    observation.store.name = side === 'baseline'
      ? 'PLUS synthetic fixture'
      : 'DekaMarkt synthetic fixture'
    for (const line of observation.lines) line.observedProduct.available = false
  }
  return sheet
}

test('M3 converter: blocked output parent with fictional private key does not leak output path [expected RED]', () => {
  withScratch((directory) => {
    const source = join(directory, 'synthetic-sheet.json')
    const bytes = Buffer.from(JSON.stringify(fictionalUnavailableSheet()))
    writeFileSync(source, bytes, { mode: 0o600 })
    const blocker = join(directory, PRIVATE_CANARY)
    writeFileSync(blocker, 'ordinary regular file')
    const output = join(blocker, 'derived-study.json')
    const result = run(CONVERTER, source, output)
    assert.deepEqual(readFileSync(source), bytes, 'input must remain exactly intact')
    assert.doesNotMatch(
      result.stderr,
      new RegExp(PRIVATE_CANARY),
      'output-directory failures must not reveal private names to stderr',
    )
  })
})

test('M3 assessor: blocked output parent with fictional private key does not leak output path [expected RED]', () => {
  withScratch((directory) => {
    const source = join(directory, 'synthetic-study.json')
    const bytes = Buffer.from(JSON.stringify(
      buildWeeklyBasketStudyFromObservationSheet(fictionalUnavailableSheet()),
    ))
    writeFileSync(source, bytes, { mode: 0o600 })
    const blocker = join(directory, PRIVATE_CANARY)
    writeFileSync(blocker, 'ordinary regular file')
    const output = join(blocker, 'assessment.json')
    const result = run(ASSESSOR, source, output)
    assert.deepEqual(readFileSync(source), bytes, 'input must remain exactly intact')
    assert.doesNotMatch(
      result.stderr,
      new RegExp(PRIVATE_CANARY),
      'output write failures must not reveal private names to stderr',
    )
  })
})

test('M3 canonical unavailable-only synthetic CLI pipeline remains unknown, null and unclaimable [control]', () => {
  withScratch((directory) => {
    const source = join(directory, 'synthetic-sheet.json')
    const studyFile = join(directory, 'derived-study.json')
    const reportFile = join(directory, 'assessment.json')
    const bytes = Buffer.from(JSON.stringify(fictionalUnavailableSheet()))
    writeFileSync(source, bytes, { mode: 0o600 })
    for (const [script, input, output] of [
      [CONVERTER, source, studyFile],
      [ASSESSOR, studyFile, reportFile],
    ]) {
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', script, input, '--output', output],
        { cwd: ROOT, encoding: 'utf8', timeout: 15000 },
      )
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '')
      assert.equal(existsSync(output), true)
      assert.doesNotMatch(result.stderr, /SYNTHETIC_PARTICIPANT_DO_NOT_PRINT/)
    }
    const study = JSON.parse(readFileSync(studyFile, 'utf8'))
    const report = JSON.parse(readFileSync(reportFile, 'utf8'))
    assert.equal(study.baseline.basket.unresolvedLineCount, 11)
    assert.equal(study.candidate.basket.unresolvedLineCount, 11)
    assert.deepEqual(readFileSync(source), bytes, 'source must remain untouched')
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.savingsCents, null)
    assert.equal(report.deltaCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
  })
})
