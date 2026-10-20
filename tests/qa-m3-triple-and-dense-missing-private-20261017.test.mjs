import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Independent, QA-only missing-evidence coverage beyond the merged
// exhaustive TWO-missing matrix. No retailer network access or real prices.
// Three simultaneous unavailable products and densely missing 4..21-product
// baskets stress paired 11+11 provenance without fabricating whole totals.
const contexts = ['in-store', 'online-order']
const positions = Array.from({ length: 22 }, (_, id) => ({
  side: id < 11 ? 'baseline' : 'candidate', row: id % 11,
}))
const stalePrivateCents = 777777
let scenarioCount = 0

function verifyIncompletePhysicalBasket(context, absentIds) {
  const absent = new Set(absentIds)
  assert.equal(absent.size, absentIds.length, 'scenario must use distinct positions')
  assert.ok(absent.size >= 3 && absent.size < 22)
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.priceContext = context
  for (const id of absent) {
    const { side, row } = positions[id]
    sheet[side].lines[row].observedProduct.priceCents = stalePrivateCents
    sheet[side].lines[row].observedProduct.available = false
  }
  const originalSheet = JSON.stringify(sheet)
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(JSON.stringify(sheet), originalSheet, 'observation was mutated')
  assert.equal(report.privateOnly, true)
  assert.equal(report.priceContext, context)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.fullBasket.comparable, false)
  assert.equal(report.fullBasket.outcome, 'unknown')
  for (const key of ['plusTotalCents','dekamarktTotalCents','deltaCents','provisionalSavingsCents']) {
    assert.equal(report.fullBasket[key], null, key + ' must remain nonclaimable')
  }
  let knownPlus = 0
  let knownDeka = 0
  let comparable = 0
  for (let row = 0; row < 11; row++) {
    const plusKnown = !absent.has(row)
    const dekaKnown = !absent.has(row + 11)
    const line = report.lines[row]
    assert.equal(line.plus.status, plusKnown ? 'known' : 'unresolved')
    assert.equal(line.dekamarkt.status, dekaKnown ? 'known' : 'unresolved')
    assert.equal(line.plus.lineTotalCents, plusKnown ? 100 : null)
    assert.equal(line.dekamarkt.lineTotalCents, dekaKnown ? 90 : null)
    assert.equal(line.provisionalLineDeltaCents, plusKnown && dekaKnown ? -10 : null)
    if (plusKnown) knownPlus++
    if (dekaKnown) knownDeka++
    if (plusKnown && dekaKnown) comparable++
  }
  assert.equal(report.comparableLineCount, comparable)
  assert.equal(report.unmatchedLineCount, 11 - comparable)
  assert.equal(report.knownSubtotalsCents.plus, 100 * knownPlus)
  assert.equal(report.knownSubtotalsCents.dekamarkt, 90 * knownDeka)
  assert.equal(report.knownSubtotalsCents.incompleteBasket, true)
  const beforeRender = JSON.stringify(report)
  const html = renderPrivateM3ProductComparisonHtml(report)
  const csv = renderPrivateM3ComparisonCsv(report)
  assert.equal(JSON.stringify(report), beforeRender, 'renderer mutated financial report')
  assert.equal((html.match(/<tr><th scope="row">/gu) ?? []).length, 11)
  assert.match(html, /Nog geen betrouwbare winnaar/)
  assert.doesNotMatch(html, /is goedkoper voor dit volledige gemeten mandje/)
  assert.equal(csv.charCodeAt(0), 0xfeff, 'private CSV requires spreadsheet BOM')
  const rows = csv.slice(1).trimEnd().split('\r\n')
  assert.equal(rows.length, 14, 'exact private CSV schema')
  for (const row of rows.slice(1)) assert.equal(row.split(';').length, 19)
  assert.match(rows[13], /VOLLEDIGE MAND ONBEKEND/)
  assert.doesNotMatch(csv, /VOORLOPIGE VOLLEDIGE MAND/)
  assert.equal(JSON.stringify(report).includes(String(stalePrivateCents)), false)
  assert.equal((html + csv).includes('7777,77'), false, 'stale unavailable money leaked')
  scenarioCount++
}

test('M3 exhaustive triple-unavailable 11+11 physical observations never invent a full basket', () => {
  let checked = 0
  for (const context of contexts) for (let a = 0; a < 22; a++)
    for (let b = a + 1; b < 22; b++)
      for (let c = b + 1; c < 22; c++) {
        verifyIncompletePhysicalBasket(context, [a, b, c])
        checked++
      }
  assert.equal(checked, 3080, '2 contexts × 22-choose-3')
})

test('M3 dense 4..21 absent physical products keep exact subtotals across all rotations', () => {
  let checked = 0
  for (const context of contexts)
    for (let absentCount = 4; absentCount <= 21; absentCount++)
      for (let rotation = 0; rotation < 22; rotation++) {
        const absent = Array.from({ length: absentCount }, (_, n) => (n * 7 + rotation) % 22)
        verifyIncompletePhysicalBasket(context, absent)
        checked++
      }
  assert.equal(checked, 792, '2 contexts × 18 sizes × 22 rotated masks')
  assert.equal(scenarioCount, 3872, 'all exhaustive and dense private scenarios ran')
})
