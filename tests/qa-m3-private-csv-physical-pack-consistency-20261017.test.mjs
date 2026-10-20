import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import {
  auditPrivateM3CsvLedger,
  exactPrivateM3CsvPackCount,
} from '../scripts/qa-m3-private-csv-ledger-check.mjs'

// Only fictional amounts and prices. No live retailer HTTP, PII or permission.
function syntheticCsv(incomplete = false) {
  const sheet = buildFictionalPricedSheet(90)
  if (incomplete) sheet.candidate.lines[0].observedProduct.available = false
  return renderPrivateM3ComparisonCsv(buildPrivateM3ProductComparison(sheet))
}

function mutateCells(csv, row, changes) {
  const records = csv.slice(1, -2).split('\r\n')
  const cells = records[row].slice(1, -1).split('";"')
  assert.equal(cells.length, 19)
  for (const [column, value] of changes) {
    assert.equal(/[;"\r\n]/u.test(value), false)
    cells[column] = value
  }
  records[row] = cells.map(x => '"' + x + '"').join(';')
  return '\ufeff' + records.join('\r\n') + '\r\n'
}

test('physical independent oracle: exact integer-boundary mass, liquid, piece, and multipacks', () => {
  const good = [
    ['450', 'g', '0.144', 'g', '1', 3125n],
    ['0.45', 'kg', '0.000144', 'kg', '1', 3125n],
    ['450', 'g', '0.45', 'kg', '1', 1n],
    ['450', 'g', '0.225', 'kg', '1', 2n],
    ['0.00007', 'l', '0.07', 'ml', '1', 1n],
    ['400', 'ml', '0.2', 'l', '2', 1n],
    ['6', 'piece', '1', 'piece', '3', 2n],
    ['2', 'piece', '1', 'piece', '2', 1n],
    ['1e-7', 'l', '0.0001', 'ml', '1', 1n],
    ['5e-324', 'g', '5e-324', 'g', '1', 1n],
  ]
  for (const [required, unit, amount, packUnit, count, packs] of good) {
    assert.equal(exactPrivateM3CsvPackCount(required, unit, amount, packUnit, count), packs)
  }
})

test('physical independent oracle rejects invalid, incompatible, noncanonical or overflowing inputs', () => {
  const invalid = [
    ['450', 'g', '45', 'ml', '1'],
    ['6', 'piece', '1', 'g', '6'],
    ['0', 'g', '1', 'g', '1'],
    ['450', 'g', '0', 'g', '1'],
    ['450', 'g', '-1', 'g', '1'],
    ['450', 'g', 'Infinity', 'g', '1'],
    ['450', 'g', 'NaN', 'g', '1'],
    ['450', 'g', '1e+9999', 'g', '1'],
    ['450', 'g', '001', 'g', '1'],
    ['450', 'g', '1.0', 'g', '1'],
    ['450', 'g', '45', '__proto__', '1'],
    ['450', 'g', '45', 'g', '0'],
    ['450', 'g', '45', 'g', '1.5'],
    ['9007199254740991', 'g', '5e-324', 'g', '1'],
  ]
  for (const args of invalid) {
    assert.throws(
      () => exactPrivateM3CsvPackCount(...args),
      /M3 private CSV financial consistency failed/u,
      'invalid pack vector must fail closed',
    )
  }
})

test('real M3 synthetic CSV remains valid when unit equivalents preserve exact pack multiplicity', () => {
  const original = syntheticCsv()
  assert.equal(auditPrivateM3CsvLedger(original).physicalPackConsistent, true)
  const mass = mutateCells(original, 2, [[4, '0.45'], [5, 'kg']])
  assert.equal(auditPrivateM3CsvLedger(mass).physicalPackConsistent, true)
  const volume = mutateCells(original, 6, [[4, '0.4'], [5, 'l']])
  assert.equal(auditPrivateM3CsvLedger(volume).physicalPackConsistent, true)
  const pieces = mutateCells(original, 4, [[4, '1'], [6, '2']])
  assert.equal(auditPrivateM3CsvLedger(pieces).physicalPackConsistent, true)
  assert.equal(auditPrivateM3CsvLedger(syntheticCsv(true)).fullBasketComparable, false)
})

test('all eleven shopping rows refuse an underfilled physical pack in either retailer (22 cells)', () => {
  const baseline = syntheticCsv()
  let checked = 0
  for (let row = 2; row <= 12; row++) {
    for (const amountColumn of [4, 11]) {
      const physical = baseline.slice(1, -2).split('\r\n')[row].slice(1, -1).split('";"')
      const smaller = String(Number(physical[amountColumn]) / 10)
      assert.throws(
        () => auditPrivateM3CsvLedger(mutateCells(baseline, row, [[amountColumn, smaller]])),
        /M3 private CSV financial consistency failed/u,
      )
      checked++
    }
  }
  assert.equal(checked, 22)
})

test('all eleven shopping rows refuse a doubled requirement with stale one-pack money (11 cases)', () => {
  const baseline = syntheticCsv()
  let checked = 0
  for (let row = 2; row <= 12; row++) {
    const old = baseline.slice(1, -2).split('\r\n')[row].slice(1, -1).split('";"')[1]
    assert.throws(
      () => auditPrivateM3CsvLedger(mutateCells(baseline, row, [[1, String(Number(old) * 2)]])),
      /M3 private CSV financial consistency failed/u,
    )
    checked++
  }
  assert.equal(checked, 11)
})

test('incomplete private basket keeps unknown status; known PLUS pack cannot be too small', () => {
  const incomplete = syntheticCsv(true)
  assert.equal(auditPrivateM3CsvLedger(incomplete).physicalPackConsistent, true)
  assert.throws(
    () => auditPrivateM3CsvLedger(mutateCells(incomplete, 2, [[4, '45']])),
    /M3 private CSV financial consistency failed/u,
  )
})
