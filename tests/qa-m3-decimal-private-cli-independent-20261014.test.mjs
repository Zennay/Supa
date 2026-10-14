import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'

// Independent QA: exercise the actual two-stage private CLIs, not the source
// helper used by the product owner's own tests. All prices/data are fictional.
const cli = (script, input, output) =>
  spawnSync(process.execPath, [
    '--experimental-strip-types', script, input, '--output', output,
  ], { encoding: 'utf8', timeout: 20_000 })

function privateSandbox(callback) {
  const root = mkdtempSync(join(tmpdir(), 'supa-qa-decimal-m3-'))
  try {
    return callback({
      sheet: join(root, 'private-sheet.json'),
      study: join(root, 'private-study.json'),
      report: join(root, 'private-report.json'),
      root,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function riceIndex(sheet) {
  const index = sheet.requirements.findIndex(
    (item) => item.amount === 450 && item.unit === 'g',
  )
  assert.notEqual(index, -1, 'frozen M3 demand must include 450 g')
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  return index
}

function runPrivateCli(script, input, output) {
  const result = cli(script, input, output)
  assert.equal(result.status, 0, `${script}: ${result.stderr}`)
  assert.equal(result.stdout, '', 'private JSON must not be printed to stdout')
  assert.equal(result.stderr, '', 'successful private processing must be quiet')
  assert.equal(statSync(output).mode & 0o777, 0o600, 'private output must be 0600')
  return JSON.parse(readFileSync(output, 'utf8'))
}

test('independent two-stage M3 CLI: exact decimal packs on both 11-line baskets and private report', () =>
  privateSandbox(({ sheet: input, study: derived, report: output }) => {
    const source = buildFictionalPricedSheet(90)
    const index = riceIndex(source)
    const baselineProduct = source.baseline.lines[index].observedProduct
    baselineProduct.packAmount = 0.144
    baselineProduct.packUnit = 'g'
    baselineProduct.packCount = 1 // 450 / .144 = exactly 3125
    const candidateProduct = source.candidate.lines[index].observedProduct
    candidateProduct.packAmount = 0.144
    candidateProduct.packUnit = 'g'
    candidateProduct.packCount = 3 // 450 / (.144 * 3) = ceil(1041.66...) = 1042
    const originalBytes = JSON.stringify(source)
    writeFileSync(input, originalBytes, { mode: 0o600 })

    const study = runPrivateCli('scripts/m3-build-observed-study.mjs', input, derived)
    const assessment = runPrivateCli('scripts/m3-assess-observed-week.mjs', derived, output)
    assert.equal(study.baseline.basket.lines[index].packs, 3125)
    assert.equal(study.candidate.basket.lines[index].packs, 1042)
    assert.equal(study.baseline.basket.totalCents, 313500)
    assert.equal(study.candidate.basket.totalCents, 94680)
    assert.equal(study.baseline.basket.matchedLineCount, 11)
    assert.equal(study.candidate.basket.matchedLineCount, 11)
    assert.equal(assessment.baselineTotalCents, 313500)
    assert.equal(assessment.candidateTotalCents, 94680)
    assert.equal(assessment.outcome, 'better')
    assert.equal(assessment.savingsCents, 218820)
    assert.equal(assessment.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(assessment, 'participantKey'), false)
    assert.doesNotMatch(JSON.stringify(assessment), /fictional-operator-key/)
    assert.equal(readFileSync(input, 'utf8'), originalBytes, 'human input remains intact')
  }))

test('independent private assessor CLI refuses forged phantom pack even with reconciled cents', () =>
  privateSandbox(({ sheet: input, study: derived, report: output, root }) => {
    const source = buildFictionalPricedSheet()
    const index = riceIndex(source)
    source.baseline.lines[index].observedProduct.packAmount = 0.144
    writeFileSync(input, JSON.stringify(source), { mode: 0o600 })
    const study = runPrivateCli('scripts/m3-build-observed-study.mjs', input, derived)
    const line = study.baseline.basket.lines[index]
    assert.equal(line.packs, 3125)
    line.packs = 3126
    line.lineTotalCents += line.pricePerPackCents
    study.baseline.basket.totalCents += line.pricePerPackCents
    const invalidBytes = JSON.stringify(study)
    writeFileSync(derived, invalidBytes, { mode: 0o600 })
    const attempt = cli('scripts/m3-assess-observed-week.mjs', derived, output)
    assert.notEqual(attempt.status, 0, 'invalid quantity must be rejected')
    assert.equal(attempt.stdout, '')
    assert.match(attempt.stderr, /packs must equal the quantity required/)
    assert.doesNotMatch(attempt.stderr, /fictional-operator-key|fictional-operator|private-sheet|private-study/)
    assert.equal(existsSync(output), false, 'a failed validation must not produce a report')
    assert.equal(readFileSync(derived, 'utf8'), invalidBytes, 'private study cannot be overwritten')
    assert.equal(existsSync(root), true)
  }))

test('one unavailable synthetic M3 basket line abstains, even if its stale price is large', () =>
  privateSandbox(({ sheet: input, study: derived, report: output }) => {
    const source = buildFictionalPricedSheet(90)
    const index = riceIndex(source)
    source.baseline.lines[index].observedProduct.available = false
    source.baseline.lines[index].observedProduct.priceCents = 999999999
    writeFileSync(input, JSON.stringify(source), { mode: 0o600 })
    const study = runPrivateCli('scripts/m3-build-observed-study.mjs', input, derived)
    assert.equal(study.baseline.basket.lines[index].status, 'unresolved')
    assert.equal(study.baseline.basket.matchedLineCount, 10)
    assert.equal(study.baseline.basket.unresolvedLineCount, 1)
    assert.equal(study.baseline.basket.totalCents, 1000)
    const report = runPrivateCli('scripts/m3-assess-observed-week.mjs', derived, output)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.claimable, false)
    assert.equal(report.savingsCents, null)
    assert.equal(report.deltaCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
  }))
