import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// All cases are synthetic, local, immutable M3 admission controls. A product
// marked available:true still needs a real product, valid size and exact cents.
// Partial/invalid price facts must NEVER create a whole-basket price or winner.
const invalid = [
  ['empty product name', item => { item.productName = '' }],
  ['missing pack price', item => { item.priceCents = null }],
  ['zero physical pack amount', item => { item.packAmount = 0 }],
  ['unknown physical pack unit', item => { item.packUnit = 'unknown' }],
  ['zero pieces in a multipack', item => { item.packCount = 0 }],
  ['incompatible physical unit family', item => { item.packUnit = item.packUnit === 'ml' || item.packUnit === 'l' ? 'g' : 'l' }],
]
const contexts = ['in-store', 'online-order']
function fixture(context, side, index, mutate) {
  const source = buildFictionalPricedSheet(90)
  source.study.priceContext = context
  const product = source[side].lines[index].observedProduct
  assert.equal(product.available, true)
  mutate(product)
  const before = JSON.stringify(source)
  const report = buildPrivateM3ProductComparison(source)
  assert.equal(JSON.stringify(source), before, 'conversion cannot alter private observation')
  return report
}
function linesFromCsv(csv) {
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const rows = csv.slice(1).trimEnd().split('\r\n')
  assert.equal(rows.length, 14, 'advisory + header + 11 lines + summary')
  assert.equal(rows[1].split(';').length, 19)
  for (const row of rows.slice(2, 13)) assert.equal(row.split(';').length, 19)
  return rows
}
test('M3: 264 available-but-invalid 11×2 products cannot make private HTML/CSV whole baskets', () => {
  let cases = 0
  const exercised = new Map()
  for (const context of contexts) for (const [reason, mutate] of invalid) {
    for (const side of ['baseline', 'candidate']) for (let i = 0; i < 11; i++) {
      const report = fixture(context, side, i, mutate)
      assert.equal(report.lines.length, 11)
      assert.equal(report.fullBasket.comparable, false, reason)
      assert.equal(report.fullBasket.outcome, 'unknown', reason)
      for (const field of ['plusTotalCents','dekamarktTotalCents','deltaCents','provisionalSavingsCents']) {
        assert.equal(report.fullBasket[field], null, field + ': ' + reason)
      }
      assert.equal(report.knownSubtotalsCents.incompleteBasket, true)
      assert.equal(report.comparableLineCount, 10)
      assert.equal(report.unmatchedLineCount, 1)
      assert.equal(report.privateOnly, true)
      assert.equal(report.verifiedRetailerObservations, false)
      assert.equal(report.publicSavingsClaimEligible, false)
      const retailer = side === 'baseline' ? 'plus' : 'dekamarkt'
      assert.equal(report.lines[i][retailer].status, 'unresolved', reason)
      assert.equal(report.lines[i].provisionalLineDeltaCents, null)
      assert.equal(report.knownSubtotalsCents.plus, side === 'baseline' ? 1000 : 1100)
      assert.equal(report.knownSubtotalsCents.dekamarkt, side === 'candidate' ? 900 : 990)
      const before = JSON.stringify(report)
      const html = renderPrivateM3ProductComparisonHtml(report)
      const csv = renderPrivateM3ComparisonCsv(report)
      assert.equal(JSON.stringify(report), before, 'private formatting must not mutate data')
      assert.match(html, /Nog geen betrouwbare winnaar/u)
      assert.match(html, /Niet betrouwbaar geprijsd/u)
      assert.match(html, /Bekende deeltotalen/u)
      assert.doesNotMatch(html, /Beide volledige mandjes kosten evenveel|is goedkoper voor dit volledige/u)
      assert.equal((html.match(/<tr><th scope="row">/gu) ?? []).length, 11)
      assert.match(csv, /VOLLEDIGE MAND ONBEKEND/u)
      assert.doesNotMatch(csv, /VOORLOPIGE VOLLEDIGE MAND/u)
      assert.match(csv, /NIET GEVERIFIEERD/u)
      linesFromCsv(csv)
      exercised.set(reason, (exercised.get(reason) ?? 0) + 1)
      cases++
    }
  }
  assert.equal(cases, 264)
  for (const [reason] of invalid) assert.equal(exercised.get(reason), 44)
})
test('M3: same 11x2 pack prices remain comparable when all pack facts are valid', () => {
  for (const context of contexts) {
    const report = fixture(context, 'candidate', 0, () => {})
    assert.equal(report.fullBasket.comparable, true)
    assert.equal(report.fullBasket.outcome, 'better')
    assert.equal(report.fullBasket.deltaCents, -110)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.match(renderPrivateM3ProductComparisonHtml(report), /voorlopig/u)
    assert.match(renderPrivateM3ComparisonCsv(report), /VOORLOPIGE VOLLEDIGE MAND/u)
  }
})
