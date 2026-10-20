import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'

// These are purely fictional cent prices and physical packaging, not current
// licensed offers or observations. Each test probes the ACTUAL field-sheet
// producer -> money/pack conversion -> both private operator views.
const privateCanary = 'PRIVATE_MULTIPACK_OPERATOR_20261017'

function money(cents) {
  const neg = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return neg + String(Math.floor(absolute / 100)) + ',' +
    String(absolute % 100).padStart(2, '0')
}

function summary(csv) {
  const rows = csv.trimEnd().split('\r\n')
  assert.equal(rows.length, 14)
  return rows[13].slice(1, -1).split('";"')
}

const variants = [
  { name: 'single half-sized pack', ratio: 0.5, count: 1, packs: 2, price: 123 },
  { name: 'two items per half-sized pack', ratio: 0.5, count: 2, packs: 1, price: 123 },
  { name: 'single double-sized pack', ratio: 2, count: 1, packs: 1, price: 0 },
  { name: 'fourth-sized two-item pack', ratio: 0.25, count: 2, packs: 2, price: 17 },
]

test('all 11×2 physical line positions × 4 synthetic package variants conserve exact cents in M3 JSON, HTML and CSV', () => {
  let cases = 0
  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < 11; index++) {
      for (const variant of variants) {
        const sheet = buildFictionalPricedSheet(90)
        sheet.study.population = privateCanary
        const row = sheet[side].lines[index]
        const demanded = row.requirement.amount
        const product = row.observedProduct
        const isPiece = row.requirement.unit === 'piece'
        // Real item counts are integral. A two-piece need can be supplied
        // by two individual units or one verified two-item multipack.
        if (isPiece && variant.ratio === 0.25) continue
        const packageAmount = isPiece && variant.ratio === 0.5
          ? 1 : demanded * variant.ratio
        if (!Number.isFinite(packageAmount) || packageAmount <= 0) continue
        product.packAmount = packageAmount
        product.packCount = variant.count
        product.priceCents = variant.price
        const original = structuredClone(sheet)
        const report = buildPrivateM3ProductComparison(sheet)
        const html = renderPrivateM3ProductComparisonHtml(report)
        const csv = renderPrivateM3ComparisonCsv(report)
        const label = `${side} ingredient ${index}: ${variant.name}`
        const actual = report.lines[index][side === 'baseline' ? 'plus' : 'dekamarkt']
        const expectedPacks = Math.ceil(demanded / (packageAmount * variant.count))
        const expectedLineCents = expectedPacks * variant.price
        assert.equal(actual.status, 'known', label)
        assert.equal(actual.packages, expectedPacks, label)
        assert.equal(actual.itemsPerPackage, variant.count, label)
        assert.equal(actual.pricePerPackageCents, variant.price, label)
        assert.equal(actual.lineTotalCents, expectedLineCents, label)
        const expectedPlus = side === 'baseline' ? 1000 + expectedLineCents : 1100
        const expectedDeka = side === 'candidate' ? 900 + expectedLineCents : 990
        const delta = expectedDeka - expectedPlus
        assert.equal(report.fullBasket.comparable, true, label)
        assert.equal(report.fullBasket.outcome,
          delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same', label)
        assert.equal(report.fullBasket.plusTotalCents, expectedPlus, label)
        assert.equal(report.fullBasket.dekamarktTotalCents, expectedDeka, label)
        assert.equal(report.fullBasket.deltaCents, delta, label)
        assert.equal(report.fullBasket.provisionalSavingsCents, -delta, label)
        assert.equal(report.publicSavingsClaimEligible, false, label)
        assert.equal(report.verifiedRetailerObservations, false, label)
        const footer = summary(csv)
        assert.equal(footer[0], 'VOORLOPIGE VOLLEDIGE MAND', label)
        assert.equal(footer[9], money(expectedPlus), label)
        assert.equal(footer[16], money(expectedDeka), label)
        assert.equal(footer[17], money(delta), label)
        assert.match(html, /Niet onafhankelijk geverifieerd/, label)
        assert.match(csv, /Geen actuele prijsfeed en geen publieke besparingsclaim/, label)
        assert.doesNotMatch(html + csv, /PRIVATE_MULTIPACK_OPERATOR_20261017|participantKey|sourceUrl|provenanceNote|evidenceId/i, label)
        assert.deepEqual(sheet, original, label + ' source unchanged')
        cases++
      }
    }
  }
  assert.equal(cases, 86, '22 positions × 4 pack scenarios except two invalid fractional-piece candidates')
})
