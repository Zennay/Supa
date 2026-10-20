import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { auditPrivateM3ComparisonCsv } from '../scripts/qa-m3-private-comparison-csv-audit.mjs'

function canonicalCsv(incomplete = false) {
  const sheet = buildFictionalPricedSheet(90)
  if (incomplete) sheet.candidate.lines[0].observedProduct.available = false
  return renderPrivateM3ComparisonCsv(buildPrivateM3ProductComparison(sheet))
}

function overwriteQuotedCell(csv, physicalRow, cellIndex, value) {
  assert.equal(/[;"\r\n]/u.test(value), false, 'synthetic mutation must be one quoted cell')
  const lines = csv.split('\r\n')
  const columns = lines[physicalRow].split(';')
  assert.ok(columns.length === 19 || (physicalRow === 0 && columns.length === 2))
  columns[cellIndex] = '"' + value + '"'
  lines[physicalRow] = columns.join(';')
  return lines.join('\r\n')
}

test('M3 private CSV full-cell audit still accepts genuine synthetic positive/negative money and unknown packs', () => {
  for (const incomplete of [false, true]) {
    const csv = canonicalCsv(incomplete)
    assert.equal(auditPrivateM3ComparisonCsv(csv).canonicalShoppingRows, 11)
    assert.equal(auditPrivateM3ComparisonCsv(csv).publicSavingsClaimEligible, false)
  }
})

test('M3 private CSV preflight refuses formula-shaped content in all 12 numeric slots across 11 rows', () => {
  // This is intentionally independent of the original exporter: treat a
  // private CSV as potentially hand-edited before opening in a spreadsheet.
  const good = canonicalCsv()
  const numericSlots = [1, 4, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17]
  const formulas = [
    '=1+1', '\u2060=1+1', '+SUM(1)', '-HYPERLINK(1)',
    '@SUM(1)', '1e+NaN',
  ]
  let attempts = 0
  for (const physicalRow of Array.from({ length: 11 }, (_, i) => i + 2)) {
    for (const index of numericSlots) {
      for (const value of formulas) {
        assert.throws(
          () => auditPrivateM3ComparisonCsv(overwriteQuotedCell(good, physicalRow, index, value)),
          /preflight failed/u,
          'forged numeric CSV must not become an inert-data certification',
        )
        attempts++
      }
    }
  }
  assert.equal(attempts, 792)
})

test('M3 private CSV preflight checks all header/advisory text cells and footer EUR totals', () => {
  const good = canonicalCsv()
  for (const [row, index, value] of [
    [0, 1, '\u2060=1+1'],
    [1, 5, '=HYPERLINK(1)'],
    [1, 18, '\u202e＝1+1'],
    [13, 9, '\u2060=1+1'],
    [13, 16, '+SUM(1)'],
    [13, 17, '-HYPERLINK(1)'],
  ]) assert.throws(
    () => auditPrivateM3ComparisonCsv(overwriteQuotedCell(good, row, index, value)),
    /preflight failed/u,
  )
})

test('M3 private CSV preflight permits negative basket deltas only as exact euro figures', () => {
  const good = canonicalCsv()
  assert.doesNotThrow(() => auditPrivateM3ComparisonCsv(
    overwriteQuotedCell(good, 2, 17, '-12,34'),
  ))
  for (const value of ['-1+1', '−12,34', '-Infinity', '-12.34', '1e99']) {
    assert.throws(() => auditPrivateM3ComparisonCsv(
      overwriteQuotedCell(good, 2, 17, value),
    ), /preflight failed/u)
  }
})

test('M3 private CSV preflight never treats ambiguous numeric typography as monetary data', () => {
  const good = canonicalCsv()
  for (const [index, value] of [
    [1, '\u2060=1'], [4, '1,0'], [6, '0x10'], [7, '+2'],
    [8, '1.00'], [9, '1,000.00'], [11, '1\u202e'], [13, '2e2'],
    [14, '=1'], [15, 'NaN'], [16, 'Infinity'], [17, '1e+2'],
  ]) assert.throws(
    () => auditPrivateM3ComparisonCsv(overwriteQuotedCell(good, 3, index, value)),
    /preflight failed/u,
  )
})
