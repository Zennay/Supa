import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'

const htmlCli = fileURLToPath(new URL('../scripts/m3-private-comparison-html.mjs', import.meta.url))
const csvCli = fileURLToPath(new URL('../scripts/m3-private-comparison-csv.mjs', import.meta.url))
const secret = 'PRIVATE_SYNTHETIC_FIELD_PERSON_NOT_IN_OUTPUT_81943'

function cli(script, ...args) {
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', script, ...args],
    { encoding: 'utf8', timeout: 25000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  return result.stdout
}

function footerValues(csv) {
  const rows = csv.trimEnd().split('\r\n')
  assert.equal(rows.length, 14)
  const fields = rows[13].slice(1, -1).split('";"')
  assert.equal(fields.length, 19)
  return fields
}

async function withFieldSheet(sheet, action) {
  const root = await mkdtemp(join(tmpdir(), 'supa-composed-exports-'))
  try {
    const input = join(root, secret + '-field-sheet.json')
    const original = JSON.stringify(sheet)
    await writeFile(input, original, { mode: 0o600 })
    await action({ root, input, original })
    assert.equal(await readFile(input, 'utf8'), original,
      'neither product export may rewrite raw evidence')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

for (const [price, winner, plus, deka, delta] of [
  [90, 'DekaMarkt is goedkoper', '11,00', '9,90', '-1,10'],
  [100, 'Beide volledige mandjes kosten evenveel', '11,00', '11,00', '0,00'],
  [110, 'PLUS is goedkoper', '11,00', '12,10', '1,10'],
]) {
  test('M3 current-main HTML and CSV agree on all 11 fictional pairs at Deka price ' + price, async () => {
    const sheet = buildFictionalPricedSheet(price)
    sheet.study.population = secret
    await withFieldSheet(sheet, async ({ root, input }) => {
      const htmlPath = join(root, 'private-result.html')
      const csvPath = join(root, 'private-result.csv')
      assert.equal(cli(htmlCli, '--sheet', input, '--output', htmlPath), '')
      assert.equal(cli(csvCli, '--sheet', input, '--output', csvPath), '')
      assert.equal((await stat(htmlPath)).mode & 0o777, 0o600)
      assert.equal((await stat(csvPath)).mode & 0o777, 0o600)

      const html = await readFile(htmlPath, 'utf8')
      const csv = await readFile(csvPath, 'utf8')
      const foot = footerValues(csv)
      assert.match(html, new RegExp(winner))
      assert.match(html, /Indicatie:.*\/ (100 g|100 ml|stuk)/)
      assert.equal((html.match(/<tr><th scope="row">/g) ?? []).length, 11)
      assert.equal(csv.split('\r\n').filter(line => line.includes('"Voorlopig vergelijkbaar"')).length, 11)
      assert.equal(foot[0], 'VOORLOPIGE VOLLEDIGE MAND')
      assert.equal(foot[9], plus)
      assert.equal(foot[16], deka)
      assert.equal(foot[17], delta)
      assert.equal(foot[18], 'Uitsluitend lokaal, niet onafhankelijk geverifieerd')
      assert.doesNotMatch(html + csv, new RegExp(secret))
      assert.doesNotMatch(csv, /participantKey|sourceUrl|studyId|provenanceNote/)
      const assessment = buildPrivateM3ProductComparison(sheet)
      assert.equal(assessment.verifiedRetailerObservations, false)
      assert.equal(assessment.publicSavingsClaimEligible, false)
    })
  })
}

test('M3 incomplete 11+11 local pair stays unknown and unpriced in BOTH current-main exporters', async () => {
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines[0].observedProduct.available = false
  await withFieldSheet(sheet, async ({ root, input }) => {
    const htmlPath = join(root, 'incomplete.html')
    const csvPath = join(root, 'incomplete.csv')
    assert.equal(cli(htmlCli, '--sheet', input, '--output', htmlPath), '')
    assert.equal(cli(csvCli, '--sheet', input, '--output', csvPath), '')
    const html = await readFile(htmlPath, 'utf8')
    const csv = await readFile(csvPath, 'utf8')
    assert.match(html, /Nog geen betrouwbare winnaar/)
    assert.match(csv, /"VOLLEDIGE MAND ONBEKEND"/)
    assert.match(csv, /"Onbekend \/ niet volledig"/)
    assert.equal(footerValues(csv)[9], '')
    assert.equal(footerValues(csv)[16], '')
    assert.equal(footerValues(csv)[17], '')
    assert.doesNotMatch(html, /DekaMarkt is goedkoper voor dit volledige gemeten mandje/)
    assert.equal(buildPrivateM3ProductComparison(sheet).fullBasket.comparable, false)
  })
})

test('M3 combined local HTML/CSV operator help never requires a private sheet', () => {
  for (const script of [htmlCli, csvCli]) {
    const result = cli(script, '--help')
    assert.match(result, /11 boodschappen/)
    assert.match(result, /--sheet <veldformulier\.json> --output/)
    assert.match(result, /24 uur/)
    assert.doesNotMatch(result, new RegExp(secret))
  }
})
