import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { auditPrivateM3ComparisonCsv } from '../scripts/qa-m3-private-comparison-csv-audit.mjs'

const CLI = fileURLToPath(new URL('../scripts/qa-m3-private-comparison-csv-audit.mjs', import.meta.url))
function comparison(incomplete = false) {
  const sheet = buildFictionalPricedSheet(90)
  if (incomplete) sheet.candidate.lines[0].observedProduct.available = false
  return buildPrivateM3ProductComparison(sheet)
}
function csv(report = comparison()) {
  return renderPrivateM3ComparisonCsv(report)
}
function assertPrivatePass(source) {
  assert.deepEqual(auditPrivateM3ComparisonCsv(source), {
    schemaVersion: 1, privateOnly: true, safeToImportAsPlainText: true,
    canonicalShoppingRows: 11, verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
  })
}

test('QA M3 private CSV audit: ordinary complete and unknown baskets are read-only, non-public', () => {
  for (const incomplete of [false, true]) {
    const report = comparison(incomplete)
    const original = JSON.stringify(report)
    const output = csv(report)
    assertPrivatePass(output)
    assert.equal(JSON.stringify(report), original)
    assert.match(output, /PRIVE \/ NIET GEVERIFIEERD/u)
  }
})

test('QA M3 private CSV audit: proper ASCII formula quoting remains an inert literal', () => {
  const report = comparison()
  report.lines[0].plus.productName = '=HYPERLINK("https://fictional.invalid/qa", "demo")'
  report.lines[1].dekamarkt.productName = '+1+1'
  report.lines[2].ingredientLabel = '-1+1'
  report.lines[3].requiredUnit = '@SUM(A1:A5)'
  assertPrivatePass(csv(report))
})

test('QA M3 private CSV audit: structured quoted semicolons and doubled quotes stay parseable', () => {
  const report = comparison()
  for (const line of report.lines) {
    line.plus.productName = 'Synthetic; apples "500 g"'
    line.dekamarkt.productName = 'Synthetic; pears "500 g"'
    line.ingredientLabel = 'Synthetic "ingredient"; without executable prefix'
  }
  assertPrivatePass(csv(report))
})

test('QA M3 private CSV audit: 264 text cells are safely exported and tampering is rejected', () => {
  let checked = 0
  for (const prefix of ['\u2060=', '\u200f=', '\u034f=', '\u180e=', '\ufe0f=', '\u2060＝']) {
    for (const field of ['ingredientLabel', 'requiredUnit', 'plusProduct', 'dekaProduct']) {
      for (let row = 0; row < 11; row++) {
        const report = comparison()
        const secret = 'QA_SECRET_CANARY_9231'
        const value = prefix + secret + '1+1'
        if (field === 'ingredientLabel') report.lines[row].ingredientLabel = value
        if (field === 'requiredUnit') report.lines[row].requiredUnit = value
        if (field === 'plusProduct') report.lines[row].plus.productName = value
        if (field === 'dekaProduct') report.lines[row].dekamarkt.productName = value
        const original = JSON.stringify(report)
        const output = csv(report)
        const guardedCell = JSON.stringify("'" + value)
        // The normal exporter now creates a literal-text cell; the offline
        // audit must accept it without changing the private report.
        assert.ok(output.includes(guardedCell),
          'source must guard formula text before any spreadsheet is opened: ' + field + '/' + row)
        assertPrivatePass(output)
        assert.equal(JSON.stringify(report), original)
        // Simulate a manual edit that strips the protection, and prove the
        // independent pre-open audit still refuses the raw disguised formula.
        const tampered = output.replace(guardedCell, JSON.stringify(value))
        assert.notEqual(tampered, output)
        assert.throws(() => auditPrivateM3ComparisonCsv(tampered), /preflight failed/u)
        checked++
      }
    }
  }
  assert.equal(checked, 264)
})

test('QA M3 private CSV audit: fail closed on malformed CSV format and oversized records', () => {
  const good = csv()
  for (const malformed of [
    good.slice(1), good.slice(0, -2), good.replace('\r\n', '\n'),
    good.replace('"Ingrediënt"', 'Ingrediënt'),
    good.replace('"Ingrediënt"', '"Ingrediënt";"extra"'),
    good.replace('PRIVE / NIET GEVERIFIEERD', 'VERIFIED SAVINGS'),
    good + '"extra"\r\n',
    good.replace('"Ingrediënt"', '"broken quote'),
    'x'.repeat(1024 * 1024 + 5),
  ]) assert.throws(() => auditPrivateM3ComparisonCsv(malformed), /preflight failed/u)
})

test('QA M3 private CSV audit CLI: stdin-only, never echoes private values or paths', () => {
  const source = csv()
  const ok = spawnSync(process.execPath, [CLI], { input: source, encoding: 'utf8', timeout: 10_000 })
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(ok.stderr, '')
  assert.equal(JSON.parse(ok.stdout).publicSavingsClaimEligible, false)

  const report = comparison()
  const secret = 'QA_PRIVATE_CUSTOMER_TOKEN_DO_NOT_PRINT_7199'
  report.lines[0].plus.productName = '\u2060=' + secret
  const guarded = csv(report)
  const goodGuarded = spawnSync(process.execPath, [CLI], {
    input: guarded, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(goodGuarded.status, 0, goodGuarded.stderr)
  const unsafe = guarded.replace(
    JSON.stringify("'" + '\u2060=' + secret),
    JSON.stringify('\u2060=' + secret),
  )
  assert.notEqual(unsafe, guarded)
  const bad = spawnSync(process.execPath, [CLI], {
    input: unsafe, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(bad.status, 1)
  assert.equal(bad.stdout, '')
  assert.equal(bad.stderr, 'M3 private CSV safety preflight failed\n')
  assert.equal((bad.stdout + bad.stderr).includes(secret), false)

  const extraArgs = spawnSync(process.execPath, [CLI, '/private/participant.csv'], {
    input: source, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(extraArgs.status, 1)
  assert.equal(extraArgs.stdout, '')
  assert.equal(extraArgs.stderr.includes('/private/'), false)
})
