import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Independent QA-only exhaustive truth table. Each retailer has 2^11 unique
// subsets of unavailable physical products, in both supported price contexts.
// Unlike the existing pairwise missing-slot suite, this also covers 3..11
// simultaneously absent packs, arbitrary disjoint patterns and 2,048 masks
// per store. Never makes a retailer request; all cents/labels are fictional.
const COUNT = 11
const MASKS = 1 << COUNT
const STALE_CENTS = 777777

for (const context of ['in-store', 'online-order']) {
  for (const [side, outputSide] of [
    ['baseline', 'plus'], ['candidate', 'dekamarkt'],
  ]) {
    test('M3 private 2^11 physical availability combinations: ' +
      context + '/' + side, () => {
      let checked = 0
      for (let mask = 0; mask < MASKS; mask++) {
        const sheet = buildFictionalPricedSheet(90)
        sheet.study.priceContext = context
        for (let i = 0; i < COUNT; i++) {
          if ((mask & (1 << i)) !== 0) {
            sheet[side].lines[i].observedProduct.available = false
            // Historical leftover price must not count when now unavailable.
            sheet[side].lines[i].observedProduct.priceCents = STALE_CENTS
          }
        }
        const originalSheet = JSON.stringify(sheet)
        const report = buildPrivateM3ProductComparison(sheet)
        assert.equal(JSON.stringify(sheet), originalSheet,
          'converter must not alter local original observation')
        assert.equal(report.priceContext, context)
        assert.equal(report.privateOnly, true)
        assert.equal(report.verifiedRetailerObservations, false)
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal(report.lines.length, COUNT)

        const missing = mask.toString(2).split('1').length - 1
        const known = COUNT - missing
        assert.equal(report.comparableLineCount, known)
        assert.equal(report.unmatchedLineCount, missing)
        assert.equal(report.knownSubtotalsCents[outputSide],
          known * (side === 'baseline' ? 100 : 90))
        assert.equal(report.knownSubtotalsCents[
          outputSide === 'plus' ? 'dekamarkt' : 'plus'],
          COUNT * (side === 'baseline' ? 90 : 100))
        assert.equal(report.knownSubtotalsCents.incompleteBasket, mask !== 0)

        for (let i = 0; i < COUNT; i++) {
          const absent = (mask & (1 << i)) !== 0
          const row = report.lines[i]
          assert.equal(row[outputSide].status, absent ? 'unresolved' : 'known')
          assert.equal(row.provisionalLineDeltaCents, absent ? null : -10)
          if (absent) {
            assert.equal(row[outputSide].lineTotalCents, null)
            assert.equal(row[outputSide].pricePerPackageCents, null)
          }
        }
        if (mask === 0) {
          assert.equal(report.fullBasket.comparable, true)
          assert.equal(report.fullBasket.outcome, 'better')
          assert.equal(report.fullBasket.plusTotalCents, 1100)
          assert.equal(report.fullBasket.dekamarktTotalCents, 990)
          assert.equal(report.fullBasket.deltaCents, -110)
          assert.equal(report.fullBasket.provisionalSavingsCents, 110)
        } else {
          assert.equal(report.fullBasket.comparable, false)
          assert.equal(report.fullBasket.outcome, 'unknown')
          for (const key of [
            'plusTotalCents', 'dekamarktTotalCents',
            'deltaCents', 'provisionalSavingsCents',
          ]) assert.equal(report.fullBasket[key], null, key)
        }
        const frozen = JSON.stringify(report)
        const html = renderPrivateM3ProductComparisonHtml(report)
        const csv = renderPrivateM3ComparisonCsv(report)
        assert.equal(JSON.stringify(report), frozen, 'renderers must not alter input')
        assert.equal((html.match(/<tr><th scope="row">/gu) || []).length, COUNT)
        assert.equal(csv.charCodeAt(0), 0xfeff)
        assert.equal(csv.slice(1).trimEnd().split('\r\n').length, 14)
        assert.doesNotMatch(html + csv, /7777,77/u,
          'unavailable stale prices must never escape into human output')
        if (mask !== 0) {
          assert.match(html, /Nog geen betrouwbare winnaar/u)
          assert.match(html, /Bekende deeltotalen/u)
          assert.match(csv, /VOLLEDIGE MAND ONBEKEND/u)
          assert.doesNotMatch(csv, /VOORLOPIGE VOLLEDIGE MAND/u)
        } else {
          assert.match(csv, /VOORLOPIGE VOLLEDIGE MAND/u)
        }
        checked++
      }
      assert.equal(checked, MASKS)
    })
  }
}
