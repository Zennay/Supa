import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { fingerprintPrivateM3Draft } from '../scripts/m3-private-evidence-fingerprint.mjs'
import { checkPrivateM3CsvReportBinding } from '../scripts/qa-m3-private-csv-report-binding-20261017.mjs'

const cli = fileURLToPath(new URL('../scripts/qa-m3-private-csv-report-binding-20261017.mjs', import.meta.url))
const refuse = /M3 private CSV\/source binding refused/u
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex')

function fixture() {
  const sheet = buildFictionalPricedSheet(90)
  const report = buildPrivateM3ProductComparison(sheet)
  return { sheet, reportJson: JSON.stringify(report),
    csv: renderPrivateM3ComparisonCsv(report), sheetJson: JSON.stringify(sheet) }
}

test('existing two and three artifact modes remain unchanged, matching fourth sha evidence is opt-in', () => {
  const f = fixture()
  const two = checkPrivateM3CsvReportBinding(f.reportJson, f.csv)
  assert.equal(two.sourceBound, true)
  assert.equal(Object.hasOwn(two, 'sheetByteFingerprintMatched'), false)
  const three = checkPrivateM3CsvReportBinding(f.reportJson, f.csv, f.sheetJson)
  assert.equal(three.sheetProjectionConsistent, true)
  assert.equal(Object.hasOwn(three, 'sheetByteFingerprintMatched'), false)
  const four = checkPrivateM3CsvReportBinding(
    f.reportJson, f.csv, f.sheetJson, hash(f.sheetJson))
  assert.equal(Object.isFrozen(four), true)
  assert.equal(four.sourceBound, true)
  assert.equal(four.sheetProjectionConsistent, true)
  assert.equal(four.sheetByteFingerprintMatched, true)
  assert.equal(four.verifiedRetailerObservations, false)
  assert.equal(four.publicSavingsClaimEligible, false)
})

test('independently captured SHA detects altered nonprojected private metadata and raw bytes', () => {
  const f = fixture()
  let checks = 0
  const initialSha = hash(f.sheetJson)
  for (const change of [
    sheet => { sheet.study.participantKey = 'other-synthetic-operator' },
    sheet => { sheet.study.studyId = 'other-synthetic-study' },
    sheet => { sheet.baseline.provenanceNote += ' different synthetic provenance' },
    sheet => { sheet.candidate.lines[0].observedProduct.note += ' synthetic note' },
  ]) {
    const changed = structuredClone(f.sheet)
    change(changed)
    const changedText = JSON.stringify(changed)
    assert.notEqual(changedText, f.sheetJson)
    // Product-only projection ignores these properties; exact source bytes must not.
    assert.equal(checkPrivateM3CsvReportBinding(
      f.reportJson, f.csv, changedText).sheetProjectionConsistent, true)
    assert.throws(() => checkPrivateM3CsvReportBinding(
      f.reportJson, f.csv, changedText, initialSha), refuse)
    checks++
  }
  const pretty = JSON.stringify(f.sheet, null, 2)
  assert.equal(checkPrivateM3CsvReportBinding(f.reportJson, f.csv, pretty)
    .sheetProjectionConsistent, true)
  assert.throws(() => checkPrivateM3CsvReportBinding(
    f.reportJson, f.csv, pretty, initialSha), refuse)
  assert.equal(checks, 4)
})

test('invalid hash, absent field sheet and altered value always refuse without leaking source', () => {
  const f = fixture()
  for (const candidate of [
    '', '0'.repeat(63), '0'.repeat(65), 'Z'.repeat(64),
    hash(f.sheetJson).toUpperCase(), ' ' + hash(f.sheetJson),
    '0'.repeat(64), null, 1,
  ]) {
    if (candidate === null) {
      assert.throws(() => checkPrivateM3CsvReportBinding(
        f.reportJson, f.csv, null, hash(f.sheetJson)), refuse)
    } else {
      assert.throws(() => checkPrivateM3CsvReportBinding(
        f.reportJson, f.csv, f.sheetJson, candidate),
      err => err.message === 'M3 private CSV/source binding refused')
    }
  }
})

test('operator end-to-end fingerprints original 0600 file and checks report+CSV byte continuity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-original-fingerprint-'))
  try {
    await chmod(dir, 0o700)
    const f = fixture()
    const original = join(dir, 'original-field.json')
    const report = join(dir, 'comparison.json')
    const csv = join(dir, 'comparison.csv')
    await writeFile(original, f.sheetJson, { mode: 0o600 })
    await writeFile(report, f.reportJson, { mode: 0o600 })
    await writeFile(csv, f.csv, { mode: 0o600 })
    const pin = await fingerprintPrivateM3Draft(original)
    assert.equal(pin.sha256, hash(f.sheetJson))
    const run = (...args) => spawnSync(process.execPath, [cli, ...args],
      { encoding: 'utf8', timeout: 10000 })
    const good = run(report, csv, '--sheet', original, '--sheet-sha256', pin.sha256)
    assert.equal(good.status, 0, good.stderr)
    assert.equal(good.stderr, '')
    const proof = JSON.parse(good.stdout)
    assert.equal(proof.sheetByteFingerprintMatched, true)
    assert.equal(proof.sheetProjectionConsistent, true)
    assert.equal(proof.publicSavingsClaimEligible, false)
    assert.equal(proof.verifiedRetailerObservations, false)
    assert.doesNotMatch(good.stdout, /participant|PLUS|DekaMarkt|original-field|comparison.csv|[a-f0-9]{64}/iu)
    assert.equal(await readFile(original, 'utf8'), f.sheetJson)
    const changes = structuredClone(f.sheet)
    changes.study.participantKey = 'different-synthetic-participant'
    await writeFile(original, JSON.stringify(changes), { mode: 0o600 })
    const wrong = run(report, csv, '--sheet', original, '--sheet-sha256', pin.sha256)
    assert.notEqual(wrong.status, 0)
    assert.equal(wrong.stdout, '')
    assert.equal(wrong.stderr, 'M3 private CSV/source binding refused\n')
    assert.doesNotMatch(wrong.stderr, /different-synthetic|original-field|[a-f0-9]{64}/iu)
    await writeFile(original, f.sheetJson, { mode: 0o600 })
    for (const arguments_ of [
      [report, csv, '--sheet-sha256', pin.sha256],
      [report, csv, '--sheet', original, '--sheet-sha256'],
      [report, csv, '--sheet', original, '--sheet-sha256', pin.sha256, '--verbose'],
      [report, csv, '--sheet', original, '--sheet-sha256', 'f'.repeat(64)],
    ]) {
      const failure = run(...arguments_)
      assert.notEqual(failure.status, 0)
      assert.equal(failure.stdout, '')
      assert.equal(failure.stderr, 'M3 private CSV/source binding refused\n')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
