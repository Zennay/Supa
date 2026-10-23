import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { auditPrivateM3CsvLedger } from '../scripts/qa-m3-private-csv-ledger-check.mjs'

const cli = fileURLToPath(new URL('../scripts/qa-m3-private-csv-ledger-check.mjs', import.meta.url))

function sample(cents = 90, unknown = false) {
  const sheet = buildFictionalPricedSheet(cents)
  if (unknown) sheet.candidate.lines[0].observedProduct.available = false
  return renderPrivateM3ComparisonCsv(buildPrivateM3ProductComparison(sheet))
}

function changeCell(csv, rowIndex, columnIndex, value) {
  assert.equal(/[;"\r\n]/u.test(value), false, 'synthetic fixture cell must be atomic')
  const lines = csv.slice(1, -2).split('\r\n')
  const cells = lines[rowIndex].slice(1, -1).split('";"')
  assert.equal(cells.length, rowIndex === 0 ? 2 : 19)
  cells[columnIndex] = value
  lines[rowIndex] = cells.map(x => '"' + x.replace(/"/gu, '""') + '"').join(';')
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

test('independent ledger checker: synthetic better, equal, worse and incomplete private baskets remain non-public', () => {
  let cases = 0
  for (const cents of [0, 90, 100, 110, 999]) for (const incomplete of [false, true]) {
    const report = auditPrivateM3CsvLedger(sample(cents, incomplete))
    assert.equal(report.privateOnly, true)
    assert.equal(report.ledgerConsistent, true)
    assert.equal(report.canonicalShoppingRows, 11)
    assert.equal(report.comparableRows, incomplete ? 10 : 11)
    assert.equal(report.fullBasketComparable, !incomplete)
    assert.equal(report.verifiedRetailerObservations, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.isFrozen(report), true)
    cases++
  }
  assert.equal(cases, 10)
})

test('independent ledger checker rejects all 11 x 7 falsified monetary and pack-count cells', () => {
  const good = sample()
  const edits = [
    [7, '99'], [8, '1,01'], [9, '1,01'],
    [14, '99'], [15, '0,91'], [16, '0,91'], [17, '-0,11'],
  ]
  let rejected = 0
  for (let line = 2; line <= 12; line++) {
    for (const [column, value] of edits) {
      assert.throws(
        () => auditPrivateM3CsvLedger(changeCell(good, line, column, value)),
        /^Error: M3 private CSV financial consistency failed$/u,
        'row ' + line + ' column ' + column,
      )
      rejected++
    }
  }
  assert.equal(rejected, 77)
})

test('private basket footer totals and status cannot contradict eleven physical rows', () => {
  const good = sample(90)
  for (const [row, col, value] of [
    [13, 9, '11,01'], [13, 16, '9,91'], [13, 17, '-1,09'],
    [13, 0, 'VOLLEDIGE MAND ONBEKEND'],
    [2, 18, 'Onbekend / niet volledig'],
  ]) assert.throws(
    () => auditPrivateM3CsvLedger(changeCell(good, row, col, value)),
    /financial consistency failed/u,
  )
})

test('incomplete baskets cannot acquire provisional winner, stale total or one-line delta', () => {
  const unknown = sample(90, true)
  for (const [row, col, value] of [
    [13, 0, 'VOORLOPIGE VOLLEDIGE MAND'],
    [13, 9, '11,00'], [13, 16, '9,90'],
    [13, 17, '-1,10'], [2, 17, '-0,10'],
    [2, 18, 'Voorlopig vergelijkbaar'],
  ]) assert.throws(
    () => auditPrivateM3CsvLedger(changeCell(unknown, row, col, value)),
    /financial consistency failed/u,
  )
})

test('private ledger CLI is opt-in, stdout metadata only, redacted stderr on malformed source', () => {
  const good = sample()
  const accepted = spawnSync(process.execPath, [cli], { input: good, encoding: 'utf8' })
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(accepted.stderr, '')
  assert.deepEqual(JSON.parse(accepted.stdout), auditPrivateM3CsvLedger(good))
  assert.doesNotMatch(accepted.stdout, /11,00|9,90|secret|participant/iu)

  const secret = 'SECRET_SIMULATED_LOCAL_PARTICIPANT_83444'
  const forged = changeCell(good, 2, 8, secret)
  const declined = spawnSync(process.execPath, [cli], { input: forged, encoding: 'utf8' })
  assert.notEqual(declined.status, 0)
  assert.equal(declined.stdout, '')
  assert.equal(declined.stderr, 'M3 private CSV financial consistency failed\n')
  assert.doesNotMatch(declined.stderr, /SECRET|participant/iu)
})

test('private CSV financial preflight blocks 19 header aliases, misleading footer and missing rights disclaimer', () => {
  const complete = sample()
  const incomplete = sample(90, true)
  const falseStatements = [
    [complete, 0, 1, 'Echte supermarktprijzen onafhankelijk gecontroleerd'],
    [complete, 13, 18, 'Geverifieerd, besparing bewezen'],
    [incomplete, 13, 18, 'Volledige mand bekend'],
  ]
  let cases = 0
  for (let column = 1; column < 19; column++) {
    falseStatements.push([complete, 1, column, 'GEVERIFIEERDE PRIJZEN'])
  }
  for (const [csv, row, column, replacement] of falseStatements) {
    assert.throws(
      () => auditPrivateM3CsvLedger(changeCell(csv, row, column, replacement)),
      /financial consistency failed/u,
      'label must never imply authentic retailer price evidence',
    )
    cases++
  }
  assert.equal(cases, 21)
})
