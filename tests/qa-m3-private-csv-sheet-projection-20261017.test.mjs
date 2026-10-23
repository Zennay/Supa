import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { checkPrivateM3CsvReportBinding } from '../scripts/qa-m3-private-csv-report-binding-20261017.mjs'

const cli = fileURLToPath(new URL('../scripts/qa-m3-private-csv-report-binding-20261017.mjs', import.meta.url))
const ERROR = /M3 private CSV\/source binding refused/u

function data(price = 90, missing = false) {
  const sheet = buildFictionalPricedSheet(price)
  if (missing) sheet.candidate.lines[0].observedProduct.available = false
  const report = buildPrivateM3ProductComparison(sheet)
  return {
    sheet,
    reportText: JSON.stringify(report),
    csv: renderPrivateM3ComparisonCsv(report),
  }
}

test('original two-artifact mode unchanged, optional 11x2 sheet projection admitted', () => {
  for (const price of [0, 90, 100, 110]) for (const missing of [false, true]) {
    const { sheet, reportText, csv } = data(price, missing)
    const before = checkPrivateM3CsvReportBinding(reportText, csv)
    assert.equal(Object.hasOwn(before, 'sheetProjectionConsistent'), false)
    const withSheet = checkPrivateM3CsvReportBinding(reportText, csv, JSON.stringify(sheet))
    assert.equal(withSheet.sheetProjectionConsistent, true)
    assert.equal(withSheet.sourceBound, true)
    assert.equal(withSheet.canonicalShoppingRows, 11)
    assert.equal(withSheet.comparableRows, missing ? 10 : 11)
    assert.equal(withSheet.publicSavingsClaimEligible, false)
    assert.equal(withSheet.verifiedRetailerObservations, false)
    assert.equal(Object.isFrozen(withSheet), true)
  }
})

test('changes to projected physical price or identity at each of 22 field positions fail closed', () => {
  const { sheet, reportText, csv } = data()
  let cases = 0
  for (const store of ['baseline', 'candidate']) for (let index = 0; index < 11; index++) {
    const mutated = structuredClone(sheet)
    mutated[store].lines[index].observedProduct.priceCents += 1
    assert.throws(
      () => checkPrivateM3CsvReportBinding(reportText, csv, JSON.stringify(mutated)),
      ERROR,
    )
    cases++
  }
  assert.equal(cases, 22)
})

test('product name edits and missing availability never inherit a comparable source report', () => {
  const { sheet, reportText, csv } = data()
  const changedName = structuredClone(sheet)
  changedName.baseline.lines[0].observedProduct.productName += ' ander artikel'
  assert.throws(
    () => checkPrivateM3CsvReportBinding(reportText, csv, JSON.stringify(changedName)),
    ERROR,
  )
  const changedAvailability = structuredClone(sheet)
  changedAvailability.candidate.lines[0].observedProduct.available = false
  assert.throws(
    () => checkPrivateM3CsvReportBinding(reportText, csv, JSON.stringify(changedAvailability)),
    ERROR,
  )
})

test('nonprojected study metadata is explicitly not authenticated by this compatibility check', () => {
  const { sheet, reportText, csv } = data()
  const modified = structuredClone(sheet)
  modified.study.participantKey = 'other-synthetic-operator-02'
  const result = checkPrivateM3CsvReportBinding(reportText, csv, JSON.stringify(modified))
  assert.equal(result.sheetProjectionConsistent, true)
  assert.equal(result.verifiedRetailerObservations, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('operator CLI optional --sheet uses three owner-only local artifacts and no output leaks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-three-way-'))
  try {
    await chmod(dir, 0o700)
    const { sheet, reportText, csv } = data()
    const source = join(dir, 'field.json')
    const comparison = join(dir, 'comparison.json')
    const exportedCsv = join(dir, 'comparison.csv')
    const sheetText = JSON.stringify(sheet)
    await writeFile(source, sheetText, { mode: 0o600 })
    await writeFile(comparison, reportText, { mode: 0o600 })
    await writeFile(exportedCsv, csv, { mode: 0o600 })
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8', timeout: 10000,
    })
    const good = run(comparison, exportedCsv, '--sheet', source)
    assert.equal(good.status, 0, good.stderr)
    assert.equal(good.stderr, '')
    assert.equal(JSON.parse(good.stdout).sheetProjectionConsistent, true)
    assert.equal(JSON.parse(good.stdout).publicSavingsClaimEligible, false)
    assert.doesNotMatch(good.stdout, /PLUS|DekaMarkt|participant|field.json|comparison.csv/iu)
    assert.equal(await readFile(source, 'utf8'), sheetText)
    const altered = structuredClone(sheet)
    altered.candidate.lines[1].observedProduct.priceCents += 1
    await writeFile(source, JSON.stringify(altered), { mode: 0o600 })
    const wrong = run(comparison, exportedCsv, '--sheet', source)
    assert.notEqual(wrong.status, 0)
    assert.equal(wrong.stdout, '')
    assert.equal(wrong.stderr, 'M3 private CSV/source binding refused\n')
    await writeFile(source, sheetText, { mode: 0o600 })
    await chmod(source, 0o644)
    assert.notEqual(run(comparison, exportedCsv, '--sheet', source).status, 0)
    await chmod(source, 0o600)
    for (const args of [
      [comparison, exportedCsv, '--sheet', comparison],
      [comparison, exportedCsv, '--sheet', exportedCsv],
      [comparison, exportedCsv, '--sheet'],
      [comparison, exportedCsv, '--unexpected', source],
    ]) {
      const result = run(...args)
      assert.notEqual(result.status, 0)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr, 'M3 private CSV/source binding refused\n')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
