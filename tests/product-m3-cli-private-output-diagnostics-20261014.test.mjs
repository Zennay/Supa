import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { privateM3OutputFailure } from '../scripts/m3-source-output-preservation.mjs'

// Fully fictional local fixtures. No human/store observations are included.
const SECRET = 'SYNTHETIC_PRIVATE_FIELD_PATH_DO_NOT_PRINT_7642'
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))
const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))

async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-cli-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}

function run(script, ...args) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8', timeout: 20000,
  })
  assert.equal(r.error, undefined, r.error?.message)
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET))
  return r
}

function unavailableFictionalSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-cli-privacy-week',
    participantKey: 'synthetic-privacy-only',
    population: 'fictional student cohort',
    region: 'fictional region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, clock, store] of [
    ['baseline', '12:00', 'PLUS synthetic retailer'],
    ['candidate', '13:00', 'DekaMarkt synthetic retailer'],
  ]) {
    sheet[side].evidenceId = side + '-fictional-observation'
    sheet[side].observedAt = '2026-10-12T' + clock + ':00Z'
    sheet[side].source = 'manual-cart'
    sheet[side].provenanceNote = 'fictional-only, not a price observation'
    sheet[side].store = { id: side + '-fictional-store', name: store }
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  return sheet
}

test('M3 private output error helper never relays arbitrary OS exception content', () => {
  const error = Object.assign(new Error('EACCES opening /private/' + SECRET), {
    code: 'EACCES', path: '/private/' + SECRET,
  })
  const result = privateM3OutputFailure(error)
  assert.equal(result.message, 'private M3 derived output could not be written')
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET))
  assert.equal(privateM3OutputFailure(new Error('refusing symlinked M3 derived output file')).message,
    'refusing symlinked M3 derived output file')
  assert.equal(privateM3OutputFailure(new Error('SYNTHETIC_SECRET')).message,
    'private M3 derived output could not be written')
})

test('M3 converter and assessor missing input paths remain redacted', () =>
  sandbox(async root => {
    for (const script of [converter, assessor]) {
      const result = run(script, join(root, SECRET, 'missing.json'), '--output', join(root, 'out.json'))
      assert.notEqual(result.status, 0)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /could not be read\/parsed/)
    }
  }))

test('M3 sheet generator preserves no-clobber and never prints private basename', () =>
  sandbox(async root => {
    const path = join(root, SECRET + '-sheet.json')
    const original = 'FICTIONAL_NO_CLOBBER_EXACT_BYTES\n'
    await writeFile(path, original, { mode: 0o600 })
    const result = run(generator, '--output', path)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /refusing to overwrite existing observation sheet/)
    assert.equal(await readFile(path, 'utf8'), original)
  }))

test('M3 converter and assessor blocked output directories redact private path', () =>
  sandbox(async root => {
    const sheet = unavailableFictionalSheet()
    const sheetInput = join(root, 'sheet.json')
    const studyInput = join(root, 'study.json')
    await writeFile(sheetInput, JSON.stringify(sheet), { mode: 0o600 })
    await writeFile(studyInput, JSON.stringify(buildWeeklyBasketStudyFromObservationSheet(sheet)), { mode: 0o600 })
    const originalSheet = await readFile(sheetInput, 'utf8')
    const originalStudy = await readFile(studyInput, 'utf8')
    const blocker = join(root, SECRET)
    await writeFile(blocker, 'UNRELATED_PRIVATE_FILE\n', { mode: 0o600 })
    for (const [script, input] of [[converter, sheetInput], [assessor, studyInput]]) {
      const result = run(script, input, '--output', join(blocker, 'derived.json'))
      assert.notEqual(result.status, 0)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /private M3 derived output could not be written/)
    }
    assert.equal(await readFile(blocker, 'utf8'), 'UNRELATED_PRIVATE_FILE\n')
    assert.equal(await readFile(sheetInput, 'utf8'), originalSheet)
    assert.equal(await readFile(studyInput, 'utf8'), originalStudy)
  }))

test('M3 canonical fictional 11+11 full CLI route stays unknown and private', () =>
  sandbox(async root => {
    const sheetInput = join(root, 'sheet.json')
    const studyOutput = join(root, 'study.json')
    const reportOutput = join(root, 'report.json')
    const sheet = unavailableFictionalSheet()
    await writeFile(sheetInput, JSON.stringify(sheet), { mode: 0o600 })
    for (const [script, input, output] of [
      [converter, sheetInput, studyOutput],
      [assessor, studyOutput, reportOutput],
    ]) {
      const r = run(script, input, '--output', output)
      assert.equal(r.status, 0, r.stderr)
      assert.equal(r.stdout, '')
      assert.equal((await stat(output)).mode & 0o777, 0o600)
    }
    const report = JSON.parse(await readFile(reportOutput, 'utf8'))
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.savingsCents, null)
    assert.equal(report.deltaCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(JSON.parse(await readFile(studyOutput, 'utf8')).baseline.basket.unresolvedLineCount, 11)
    assert.equal(JSON.parse(await readFile(studyOutput, 'utf8')).candidate.basket.unresolvedLineCount, 11)
    assert.equal(await readFile(sheetInput, 'utf8'), JSON.stringify(sheet))
  }))
