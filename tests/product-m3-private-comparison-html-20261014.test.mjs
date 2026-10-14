import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'

const cli = fileURLToPath(new URL('../scripts/m3-private-comparison-html.mjs', import.meta.url))
const secret = 'FICTIONAL_PRIVATE_PERSON_NEVER_LOG_8216'
const comparison = () => buildPrivateM3ProductComparison(buildFictionalPricedSheet(90))
const copy = value => structuredClone(value)

test('M3 private HTML shows eleven physical paired products with full provisional comparison', () => {
  const report = comparison()
  const rendered = renderPrivateM3ProductComparisonHtml(report)
  assert.match(rendered, /<html lang="nl">/)
  assert.match(rendered, /PLUS versus DekaMarkt/)
  assert.match(rendered, /€ 11,00/)
  assert.match(rendered, /€ 9,90/)
  assert.match(rendered, /DekaMarkt is goedkoper/)
  assert.match(rendered, /Niet onafhankelijk geverifieerd/)
  assert.equal((rendered.match(/<tr><th scope="row">/g) ?? []).length, 11)
  assert.match(rendered, /script-src 'none'/)
  assert.doesNotMatch(rendered, /<script\b|https:\/\//i)
})

test('M3 private HTML retains unknown basket state with a missing Deka product', () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].observedProduct.available = false
  const report = buildPrivateM3ProductComparison(sheet)
  const rendered = renderPrivateM3ProductComparisonHtml(report)
  assert.match(rendered, /Nog geen betrouwbare winnaar/)
  assert.match(rendered, /Bekende deeltotalen/)
  assert.match(rendered, /Niet betrouwbaar geprijsd/)
  assert.match(rendered, /Onbekend/)
  assert.doesNotMatch(rendered, /DekaMarkt is goedkoper voor dit volledige gemeten mandje/)
})

test('M3 private HTML escapes hostile product names and canonical ingredient labels', () => {
  const report = comparison()
  report.lines[0].plus.productName = '<img src=x onerror=alert("secret")>'
  report.lines[0].ingredientLabel = '<svg/onload=alert(1)>'
  report.lines[0].dekamarkt.productName = '<script>alert(1)</script>'
  const rendered = renderPrivateM3ProductComparisonHtml(report)
  assert.match(rendered, /&lt;img/)
  assert.match(rendered, /&lt;svg/)
  assert.match(rendered, /&lt;script&gt;/)
  assert.doesNotMatch(rendered, /<img|<svg|<script\b/)
})

test('M3 HTML refuses forged approval and financial claims without rendering', () => {
  const report = comparison()
  for (const mutate of [
    r => { r.publicSavingsClaimEligible = true },
    r => { r.privateOnly = false },
    r => { r.verifiedRetailerObservations = true },
    r => { r.fullBasket.deltaCents += 1 },
    r => { r.fullBasket.provisionalSavingsCents += 1 },
    r => { r.lines[0].provisionalLineDeltaCents -= 1 },
    r => { r.lines[0].plus.lineTotalCents += 1 },
    r => { r.lines.push(r.lines[0]) },
    r => { r.lines[0].ingredientId = r.lines[1].ingredientId },
  ]) {
    const forged = copy(report)
    mutate(forged)
    assert.throws(() => renderPrivateM3ProductComparisonHtml(forged))
  }
})

test('M3 HTML refuses invalid incomplete basket summary and overflow-like money', () => {
  const partial = buildFictionalPricedSheet(90)
  partial.baseline.lines[0].observedProduct.available = false
  const report = buildPrivateM3ProductComparison(partial)
  for (const mutate of [
    r => { r.fullBasket.outcome = 'better' },
    r => { r.fullBasket.provisionalSavingsCents = 10 },
    r => { r.knownSubtotalsCents.incompleteBasket = false },
    r => { r.lines[1].plus.pricePerPackageCents = Number.MAX_SAFE_INTEGER },
  ]) {
    const forged = copy(report)
    mutate(forged)
    assert.throws(() => renderPrivateM3ProductComparisonHtml(forged))
  }
})

test('M3 complete offline flow converts fictional 22-line field sheet into private product JSON and HTML', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-html-fullflow-'))
  try {
    const sheetFile = join(root, 'fictional-sheet.json')
    const comparisonFile = join(root, 'private-comparison.json')
    const htmlFile = join(root, 'private-comparison.html')
    const sheet = buildFictionalPricedSheet(90)
    sheet.study.population = secret
    const before = JSON.stringify(sheet)
    await writeFile(sheetFile, before, { mode: 0o600 })
    const converterScript = fileURLToPath(new URL('../scripts/m3-private-product-comparison.mjs', import.meta.url))
    for (const [script, from, to] of [
      [converterScript, sheetFile, comparisonFile],
      [cli, comparisonFile, htmlFile],
    ]) {
      const result = spawnSync(process.execPath,
        ['--experimental-strip-types', script, from, '--output', to],
        { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr, '')
      assert.equal((await stat(to)).mode & 0o777, 0o600)
    }
    assert.equal(await readFile(sheetFile, 'utf8'), before)
    const rendered = await readFile(htmlFile, 'utf8')
    assert.match(rendered, /€ 11,00/)
    assert.match(rendered, /€ 9,90/)
    assert.doesNotMatch(rendered, new RegExp(secret))
    const raw = JSON.parse(await readFile(comparisonFile, 'utf8'))
    assert.equal(raw.publicSavingsClaimEligible, false)
    assert.equal(raw.fullBasket.provisionalSavingsCents, 110)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('M3 one-command --sheet mode renders real canonical 22-line inputs without creating extra files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-one-command-'))
  try {
    const sheetPath = join(root, secret + '-raw-sheet.json')
    const output = join(root, 'private-shopping-table.html')
    const sheet = buildFictionalPricedSheet(90)
    sheet.study.population = secret
    const original = JSON.stringify(sheet)
    await writeFile(sheetPath, original, { mode: 0o600 })
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', cli,
      '--sheet', sheetPath, '--output', output,
    ], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(await readFile(sheetPath, 'utf8'), original)
    const rendered = await readFile(output, 'utf8')
    assert.match(rendered, /DekaMarkt is goedkoper/)
    assert.match(rendered, /€ 11,00/)
    assert.match(rendered, /€ 9,90/)
    assert.doesNotMatch(rendered, new RegExp(secret))

    const incomplete = buildFictionalPricedSheet(90)
    incomplete.candidate.lines[0].observedProduct.available = false
    const incompletePath = join(root, 'incomplete.json')
    const secondHtml = join(root, 'incomplete.html')
    await writeFile(incompletePath, JSON.stringify(incomplete), { mode: 0o600 })
    const second = spawnSync(process.execPath, [
      '--experimental-strip-types', cli,
      '--sheet', incompletePath, '--output', secondHtml,
    ], { encoding: 'utf8' })
    assert.equal(second.status, 0, second.stderr)
    assert.match(await readFile(secondHtml, 'utf8'), /Nog geen betrouwbare winnaar/)
    assert.doesNotMatch(await readFile(secondHtml, 'utf8'),
      /DekaMarkt is goedkoper voor dit volledige gemeten mandje/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('M3 HTML real CLI writes a private 0600 report, no source clobber or private path log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-html-test-'))
  try {
    const input = join(root, secret + '-comparison.json')
    const output = join(root, 'private-report.html')
    const data = comparison()
    const bytes = JSON.stringify(data)
    await writeFile(input, bytes, { mode: 0o600 })
    const run = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, input, '--output', output], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, '')
    assert.equal(run.stderr, '')
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.match(await readFile(output, 'utf8'), /<html lang="nl">/)
    assert.equal(await readFile(input, 'utf8'), bytes)

    const unsafe = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, input, '--output', input], { encoding: 'utf8' })
    assert.notEqual(unsafe.status, 0)
    assert.equal(unsafe.stdout, '')
    assert.doesNotMatch(unsafe.stderr, new RegExp(secret))
    assert.equal(await readFile(input, 'utf8'), bytes)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
