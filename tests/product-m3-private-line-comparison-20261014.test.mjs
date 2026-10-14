import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet, buildFictionalRehearsalSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'

const cli = fileURLToPath(new URL('../scripts/m3-private-product-comparison.mjs', import.meta.url))
const secret = 'PRIVATE_FICTIONAL_PERSON_IDENTIFIER_DO_NOT_PUBLISH_2468'

test('M3 private per-product comparison uses all canonical 11 PLUS and Deka rows', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.population = secret
  sheet.baseline.provenanceNote = secret
  const original = JSON.stringify(sheet)
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(report.lines.length, 11)
  assert.equal(report.comparableLineCount, 11)
  assert.equal(report.unmatchedLineCount, 0)
  assert.equal(report.fullBasket.comparable, true)
  assert.equal(report.fullBasket.outcome, 'better')
  assert.equal(report.fullBasket.plusTotalCents, 1100)
  assert.equal(report.fullBasket.dekamarktTotalCents, 990)
  assert.equal(report.fullBasket.provisionalSavingsCents, 110)
  assert.ok(report.lines.every(line => line.plus.packages === 1 &&
    line.dekamarkt.packages === 1 && line.provisionalLineDeltaCents === -10))
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret))
  assert.equal(JSON.stringify(sheet), original, 'calculation must not mutate original field input')
})

test('M3 private report preserves exact same/worse signed monetary outcomes', () => {
  for (const [priceCents, outcome, savings] of [
    [100, 'same', 0],
    [110, 'worse', -110],
  ]) {
    const report = buildPrivateM3ProductComparison(buildFictionalPricedSheet(priceCents))
    assert.equal(report.fullBasket.outcome, outcome)
    assert.equal(report.fullBasket.provisionalSavingsCents, savings)
    assert.equal(report.fullBasket.deltaCents, savings === 0 ? 0 : -savings)
    assert.equal(report.publicSavingsClaimEligible, false)
  }
})

test('M3 incomplete paired retailer row has no invented full basket winner', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].observedProduct.available = false
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(report.lines.length, 11)
  assert.equal(report.comparableLineCount, 10)
  assert.equal(report.unmatchedLineCount, 1)
  assert.equal(report.lines[0].dekamarkt.status, 'unresolved')
  assert.equal(report.lines[0].dekamarkt.lineTotalCents, null)
  assert.equal(report.lines[0].provisionalLineDeltaCents, null)
  assert.equal(report.knownSubtotalsCents.plus, 1100)
  assert.equal(report.knownSubtotalsCents.dekamarkt, 900)
  assert.equal(report.knownSubtotalsCents.incompleteBasket, true)
  assert.deepEqual(report.fullBasket, {
    comparable: false,
    outcome: 'unknown',
    plusTotalCents: null,
    dekamarktTotalCents: null,
    deltaCents: null,
    provisionalSavingsCents: null,
  })
})

test('M3 fully unavailable fictional 11+11 remains unknown with empty paired prices', () => {
  const report = buildPrivateM3ProductComparison(buildFictionalRehearsalSheet())
  assert.equal(report.lines.length, 11)
  assert.equal(report.comparableLineCount, 0)
  assert.equal(report.unmatchedLineCount, 11)
  assert.equal(report.fullBasket.outcome, 'unknown')
  assert.equal(report.knownSubtotalsCents.incompleteBasket, true)
  assert.ok(report.lines.every(line => line.provisionalLineDeltaCents === null &&
    line.plus.status === 'unresolved' && line.dekamarkt.status === 'unresolved'))
})

test('M3 out-of-window price captures cannot become full basket savings', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.observedAt = '2026-10-02T10:00:01Z'
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(report.comparableLineCount, 11)
  assert.equal(report.fullBasket.comparable, false)
  assert.equal(report.fullBasket.outcome, 'unknown')
  assert.equal(report.fullBasket.provisionalSavingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('M3 altered canonical ingredient demand or mismatched retailer must be refused', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].ingredientId = secret
  assert.throws(() => buildPrivateM3ProductComparison(sheet), /ingredientId must remain|canonical planner demand/)
  const wrongStore = buildFictionalPricedSheet(90)
  wrongStore.baseline.store.name = 'Different FICTIONAL store'
  assert.throws(() => buildPrivateM3ProductComparison(wrongStore), /PLUS/)
})

test('M3 actual private CLI writes mode-0600 comparison and no private stdout or logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-comparison-'))
  try {
    const sheet = buildFictionalPricedSheet(90)
    sheet.study.population = secret
    const source = join(root, secret + '-sheet.json')
    const output = join(root, 'comparison.json')
    const raw = JSON.stringify(sheet)
    await writeFile(source, raw, { mode: 0o600 })
    const response = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, source, '--output', output], { encoding: 'utf8' })
    assert.equal(response.status, 0, response.stderr)
    assert.equal(response.stdout, '')
    assert.equal(response.stderr, '')
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(await readFile(source, 'utf8'), raw)
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.lines.length, 11)
    assert.equal(report.fullBasket.provisionalSavingsCents, 110)
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret))
    const blocked = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, source, '--output', source], { encoding: 'utf8' })
    assert.notEqual(blocked.status, 0)
    assert.equal(blocked.stdout, '')
    assert.doesNotMatch(blocked.stderr, new RegExp(secret))
    assert.equal(await readFile(source, 'utf8'), raw)
  } finally { await rm(root, { recursive: true, force: true }) }
})
