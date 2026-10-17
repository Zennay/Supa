import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { auditPrivateM3CsvLedger } from '../scripts/qa-m3-private-csv-ledger-check.mjs'
import {
  checkPrivateM3CsvReportBinding,
} from '../scripts/qa-m3-private-csv-report-binding-20261017.mjs'

const cli = fileURLToPath(new URL(
  '../scripts/qa-m3-private-csv-report-binding-20261017.mjs', import.meta.url,
))
const REFUSAL = /M3 private CSV\/source binding refused/u

function fixture(price = 90, incomplete = false) {
  const sheet = buildFictionalPricedSheet(price)
  if (incomplete) sheet.candidate.lines[0].observedProduct.available = false
  const report = buildPrivateM3ProductComparison(sheet)
  return { reportJson: JSON.stringify(report), csv: renderPrivateM3ComparisonCsv(report) }
}

function cellEdit(csv, row, column, value) {
  const lines = csv.slice(1, -2).split('\r\n')
  const fields = lines[row].slice(1, -1).split('";"')
  assert.equal(fields.length, 19)
  assert.equal(/[;"\r\n]/u.test(value), false)
  fields[column] = value
  lines[row] = fields.map(s => '"' + s + '"').join(';')
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

test('11x2 genuine synthetic CSV/report pairs have only private non-public artifact consistency', () => {
  for (const price of [0, 90, 100, 120, 999]) {
    for (const incomplete of [false, true]) {
      const { reportJson, csv } = fixture(price, incomplete)
      const proof = checkPrivateM3CsvReportBinding(reportJson, csv)
      assert.equal(Object.isFrozen(proof), true)
      assert.equal(proof.sourceBound, true)
      assert.equal(proof.privateOnly, true)
      assert.equal(proof.ledgerConsistent, true)
      assert.equal(proof.physicalPackConsistent, true)
      assert.equal(proof.canonicalShoppingRows, 11)
      assert.equal(proof.comparableRows, incomplete ? 10 : 11)
      assert.equal(proof.verifiedRetailerObservations, false)
      assert.equal(proof.publicSavingsClaimEligible, false)
    }
  }
})

test('every one of 11 ingredient names and both retailer product names are source-bound, even if money still balances', () => {
  const { reportJson, csv } = fixture()
  let checks = 0
  for (const column of [0, 3, 10]) {
    for (let row = 2; row <= 12; row++) {
      // These mutations leave all eleven row totals and both basket totals
      // internally consistent, so the earlier price-ledger QA alone accepts.
      const forged = cellEdit(csv, row, column, 'Ander product, zelfde prijs')
      assert.equal(auditPrivateM3CsvLedger(forged).ledgerConsistent, true)
      assert.throws(() => checkPrivateM3CsvReportBinding(reportJson, forged), REFUSAL)
      checks++
    }
  }
  assert.equal(checks, 33)
})

test('cross-pairing an entirely *valid* lower-priced source CSV with different report is refused', () => {
  const normal = fixture(90)
  for (const otherPrice of [0, 100, 120, 999]) {
    const different = fixture(otherPrice)
    assert.throws(
      () => checkPrivateM3CsvReportBinding(normal.reportJson, different.csv),
      REFUSAL,
    )
  }
  assert.throws(
    () => checkPrivateM3CsvReportBinding(normal.reportJson, fixture(90, true).csv),
    REFUSAL,
  )
})

test('a physically equivalent edited unit still differs from the original comparison evidence', () => {
  const { reportJson, csv } = fixture()
  const equivalent = cellEdit(cellEdit(csv, 2, 4, '0.45'), 2, 5, 'kg')
  assert.throws(() => checkPrivateM3CsvReportBinding(reportJson, equivalent), REFUSAL)
})

test('truncation, malformed input and inconsistent provenance cannot leak the private JSON', () => {
  const valid = fixture()
  const secret = 'PRIVATE_LOCAL_OPERATOR_382712'
  for (const [json, csv] of [
    ['{invalid ' + secret, valid.csv],
    [valid.reportJson, valid.csv.slice(1)],
    [valid.reportJson, valid.csv.slice(0, -2)],
    [JSON.stringify({ privateOnly: true, secret }), valid.csv],
    [valid.reportJson, valid.csv + secret],
    ['', valid.csv],
    [valid.reportJson, ''],
    [valid.reportJson, '\0'],
  ]) {
    assert.throws(
      () => checkPrivateM3CsvReportBinding(json, csv),
      error => error.message === 'M3 private CSV/source binding refused' &&
        !error.message.includes(secret),
    )
  }
})

test('CLI requires mode-0600 private local artifacts, emits only aggregate metadata, never private values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-binding-'))
  try {
    await chmod(directory, 0o700)
    const valid = fixture()
    const report = join(directory, 'private-comparison.json')
    const csvPath = join(directory, 'private-comparison.csv')
    await writeFile(report, valid.reportJson, { mode: 0o600 })
    await writeFile(csvPath, valid.csv, { mode: 0o600 })
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
    const pass = run(report, csvPath)
    assert.equal(pass.status, 0, pass.stderr)
    assert.equal(pass.stderr, '')
    assert.deepEqual(JSON.parse(pass.stdout),
      checkPrivateM3CsvReportBinding(valid.reportJson, valid.csv))
    assert.doesNotMatch(pass.stdout, /DekaMarkt|PLUS|ingredient|€|90|private-comparison/iu)

    const privateToken = 'SUPER_SECRET_SYNTHETIC_PERSON_20261017'
    for (const variant of [
      [report],
      [report, csvPath, '--verbose'],
      ['--help'],
      [report, report],
      [report, join(directory, 'missing.csv')],
    ]) {
      const failure = run(...variant)
      assert.notEqual(failure.status, 0)
      assert.equal(failure.stdout, '')
      assert.equal(failure.stderr, 'M3 private CSV/source binding refused\n')
    }
    await chmod(csvPath, 0o644)
    const groupReadable = run(report, csvPath)
    assert.notEqual(groupReadable.status, 0)
    assert.equal(groupReadable.stdout, '')
    assert.equal(groupReadable.stderr, 'M3 private CSV/source binding refused\n')
    await chmod(csvPath, 0o600)

    // Even a symbolically linked private file must be rejected.
    const leafLink = join(directory, 'leaf.csv')
    await symlink(csvPath, leafLink)
    const linked = run(report, leafLink)
    assert.notEqual(linked.status, 0)
    assert.equal(linked.stdout, '')
    const hardLink = join(directory, 'extra-link.csv')
    await link(csvPath, hardLink)
    assert.notEqual(run(report, csvPath).status, 0)
    await rm(hardLink)

    const sourceDir = join(directory, 'actual')
    const aliasDir = join(directory, 'aliased')
    await mkdir(sourceDir, { mode: 0o700 })
    await symlink(sourceDir, aliasDir, 'dir')
    const nestedCsv = join(sourceDir, 'nested.csv')
    await writeFile(nestedCsv, valid.csv, { mode: 0o600 })
    assert.notEqual(run(report, join(aliasDir, 'nested.csv')).status, 0)

    const mutatedCsv = cellEdit(valid.csv, 2, 0, privateToken)
    await writeFile(csvPath, mutatedCsv, { mode: 0o600 })
    const mismatched = run(report, csvPath)
    assert.notEqual(mismatched.status, 0)
    assert.equal(mismatched.stdout, '')
    assert.equal(mismatched.stderr, 'M3 private CSV/source binding refused\n')
    assert.doesNotMatch(mismatched.stderr, /SUPER_SECRET_SYNTHETIC_PERSON_20261017/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
