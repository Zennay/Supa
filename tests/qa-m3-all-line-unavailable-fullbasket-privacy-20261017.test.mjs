import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Independent 11x2 fictional field-review matrix. Deliberately *no* retailer
// traffic, permission assertion, price publication or customer observation.
const prices = [0, 90, 100, 110, 250]
const contexts = ['in-store', 'online-order']
function reportFor(price, context, missingSide = null, missingIndex = -1) {
  const sheet = buildFictionalPricedSheet(price)
  sheet.study.priceContext = context
  if (missingSide) {
    // Preserve a stale private price to prove explicit unavailability wins.
    sheet[missingSide].lines[missingIndex].observedProduct.available = false
  }
  const original = JSON.stringify(sheet)
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(JSON.stringify(sheet), original, 'comparison builder cannot mutate source')
  assert.equal(report.lines.length, 11)
  assert.equal(report.privateOnly, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.priceContext, context)
  return report
}
function assertExport(report, expectedComparable) {
  const original = JSON.stringify(report)
  const html = renderPrivateM3ProductComparisonHtml(report)
  const csv = renderPrivateM3ComparisonCsv(report)
  assert.equal(JSON.stringify(report), original, 'formatters never alter physical money')
  assert.match(html, /Niet onafhankelijk geverifieerd/u)
  assert.equal(csv.startsWith("\ufeff\"PRIVE / NIET GEVERIFIEERD\""), true)
  assert.equal(csv.replace(/^\ufeff/u, '').split('\r\n').length, 15)
  assert.equal((html.match(/<tr><th scope="row">/gu) ?? []).length, 11)
  for (const physicalRow of csv.replace(/^\ufeff/u, '').split('\r\n').slice(1, 14)) {
    assert.equal(physicalRow.split(';').length, 19)
  }
  const footer = csv.replace(/^\ufeff/u, '').split('\r\n')[13]
  if (!expectedComparable) {
    assert.match(html, /Nog geen betrouwbare winnaar/u)
    assert.match(html, /Bekende deeltotalen/u)
    assert.match(footer, /VOLLEDIGE MAND ONBEKEND/u)
    assert.doesNotMatch(footer, /VOORLOPIGE VOLLEDIGE MAND/u)
  } else {
    assert.match(footer, /VOORLOPIGE VOLLEDIGE MAND/u)
    assert.match(footer, /niet onafhankelijk geverifieerd/u)
  }
  return { html, csv }
}
test('M3: 10 complete 11x2 fictional baskets preserve cheaper/equal/worse/zero-cent outcomes across HTML+CSV', () => {
  let combinations = 0
  for (const context of contexts) for (const price of prices) {
    const r = reportFor(price, context)
    const delta = (price - 100) * 11
    assert.equal(r.fullBasket.comparable, true)
    assert.equal(r.fullBasket.plusTotalCents, 1100)
    assert.equal(r.fullBasket.dekamarktTotalCents, price * 11)
    assert.equal(r.fullBasket.deltaCents, delta)
    assert.equal(r.fullBasket.provisionalSavingsCents, delta === 0 ? 0 : -delta)
    assert.equal(r.fullBasket.outcome, delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same')
    assert.equal(r.comparableLineCount, 11)
    assert.equal(r.unmatchedLineCount, 0)
    assert.equal(r.knownSubtotalsCents.incompleteBasket, false)
    assertExport(r, true)
    combinations++
  }
  assert.equal(combinations, 10)
})
test('M3: every one of 22 unavailable physical packs prevents full-basket money in both price contexts', () => {
  let checks = 0
  for (const context of contexts) for (const price of prices) {
    for (const side of ['baseline', 'candidate']) for (let index = 0; index < 11; index++) {
      const r = reportFor(price, context, side, index)
      assert.equal(r.fullBasket.comparable, false)
      assert.equal(r.fullBasket.outcome, 'unknown')
      for (const key of ['plusTotalCents', 'dekamarktTotalCents', 'deltaCents', 'provisionalSavingsCents']) {
        assert.equal(r.fullBasket[key], null, 'an incomplete basket cannot show full money')
      }
      assert.equal(r.comparableLineCount, 10)
      assert.equal(r.unmatchedLineCount, 1)
      assert.equal(r.knownSubtotalsCents.incompleteBasket, true)
      assert.equal(r.knownSubtotalsCents.plus, side === 'baseline' ? 1000 : 1100)
      assert.equal(r.knownSubtotalsCents.dekamarkt, price * (side === 'candidate' ? 10 : 11))
      const line = r.lines[index]
      assert.equal(line[side === 'baseline' ? 'plus' : 'dekamarkt'].status, 'unresolved')
      assert.equal(line.provisionalLineDeltaCents, null)
      assertExport(r, false)
      checks++
    }
  }
  assert.equal(checks, 220)
})
