import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// Synthetic direct end-to-end overflow controls. Assert CLI failure/safe
// abstention, not only a pure arithmetic helper. No observed retailer data.
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

function sandbox(callback) {
  const root = mkdtempSync(join(tmpdir(), 'supa-qa-m3-money-bounds-'))
  try {
    return callback({
      input: join(root, 'fictional-private-source.json'),
      study: join(root, 'fictional-private-study.json'),
      report: join(root, 'fictional-private-report.json'),
      root,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function invoke(script, input, output, cwd) {
  return spawnSync(process.execPath,
    ['--experimental-strip-types', script, input, '--output', output],
    { cwd, encoding: 'utf8', timeout: 30000 })
}

function validPrivateRun(script, input, output, cwd) {
  const result = invoke(script, input, output, cwd)
  assert.equal(result.status, 0, `${script}: ${result.stderr}`)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assert.equal(statSync(output).mode & 0o077, 0, 'output is owner-only')
  return JSON.parse(readFileSync(output, 'utf8'))
}

function fakeRice(sheet) {
  const index = sheet.requirements.findIndex((line) =>
    line.amount === 450 && line.unit === 'g')
  assert.notEqual(index, -1)
  return index
}

test('private CLI abstains when a fictional required pack count exceeds the safe integer limit', () =>
  sandbox(({ input, study: derived, report, root }) => {
    const sheet = buildFictionalPricedSheet()
    const index = fakeRice(sheet)
    sheet.baseline.lines[index].observedProduct.packAmount = 1e-20
    sheet.baseline.lines[index].observedProduct.packUnit = 'g'
    const original = JSON.stringify(sheet)
    writeFileSync(input, original, { mode: 0o600 })

    const converted = validPrivateRun(converter, input, derived, root)
    const line = converted.baseline.basket.lines[index]
    assert.equal(line.status, 'unresolved', 'no near-infinite phantom pack count')
    assert.equal(Object.hasOwn(line, 'packs'), false)
    assert.equal(Object.hasOwn(line, 'lineTotalCents'), false)
    assert.equal(converted.baseline.basket.matchedLineCount, 10)
    assert.equal(converted.baseline.basket.totalCents, 1000)
    const assessed = validPrivateRun(assessor, derived, report, root)
    assert.equal(assessed.claimable, false)
    assert.equal(assessed.outcome, 'unknown')
    assert.equal(assessed.savingsCents, null)
    assert.equal(assessed.deltaCents, null)
    assert.equal(assessed.publicSavingsClaimEligible, false)
    assert.equal(readFileSync(input, 'utf8'), original)
  }))

test('private CLI abstains on one product with safe inputs but overflowing pack-total cents', () =>
  sandbox(({ input, study: derived, report, root }) => {
    const sheet = buildFictionalPricedSheet()
    const index = fakeRice(sheet)
    const product = sheet.baseline.lines[index].observedProduct
    product.packAmount = 225
    product.packUnit = 'g'
    product.priceCents = Number.MAX_SAFE_INTEGER // 2 packs cannot be priced safely
    const original = JSON.stringify(sheet)
    writeFileSync(input, original, { mode: 0o600 })

    const converted = validPrivateRun(converter, input, derived, root)
    const line = converted.baseline.basket.lines[index]
    assert.equal(line.status, 'unresolved')
    assert.equal(Object.hasOwn(line, 'lineTotalCents'), false)
    assert.equal(converted.baseline.basket.totalCents, 1000)
    const assessed = validPrivateRun(assessor, derived, report, root)
    assert.equal(assessed.outcome, 'unknown')
    assert.equal(assessed.savingsCents, null)
    assert.equal(assessed.publicSavingsClaimEligible, false)
    assert.equal(readFileSync(input, 'utf8'), original)
  }))

test('private converter refuses cumulative unsafe basket cents before producing derived study', () =>
  sandbox(({ input, study: derived, root }) => {
    const sheet = buildFictionalPricedSheet()
    // Each independently matched line total remains safe, yet their sum
    // exceeds the Number.MAX_SAFE_INTEGER boundary. No rounded total allowed.
    for (const line of sheet.baseline.lines.slice(0, 2)) {
      line.observedProduct.priceCents = Number.MAX_SAFE_INTEGER - 1
    }
    const original = JSON.stringify(sheet)
    writeFileSync(input, original, { mode: 0o600 })
    const attempted = invoke(converter, input, derived, root)
    assert.notEqual(attempted.status, 0)
    assert.equal(attempted.stdout, '')
    assert.match(attempted.stderr, /totalCents.*safe integer/)
    assert.doesNotMatch(attempted.stderr, /fictional-private-source|fictional-operator-key/)
    assert.equal(existsSync(derived), false, 'no rounded or untrusted private output')
    assert.equal(readFileSync(input, 'utf8'), original)
  }))
