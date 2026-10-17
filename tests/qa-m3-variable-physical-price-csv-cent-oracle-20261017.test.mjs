import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Independent financial oracle: 11 different fictional physical package prices
// per retailer, not eleven copies of a single price. These are NOT observed
// retailer prices and are never suitable for public savings claims.
const money = cents => {
  const value = BigInt(cents)
  const minus = value < 0n ? '-' : ''
  const mag = value < 0n ? -value : value
  return minus + String(mag / 100n) + ',' + String(mag % 100n).padStart(2, '0')
}
const unquote = field => {
  assert.ok(field.startsWith('"') && field.endsWith('"'), 'CSV cell must be quoted')
  return field.slice(1, -1).replace(/""/g, '"')
}
function pricesFor(seed, direction) {
  let x = seed >>> 0
  const step = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) % 1000)
  const plus = []
  const deka = []
  for (let i = 0; i < 11; i++) {
    const baseline = 100 + step() % 400
    const adjustment = 1 + step() % 75
    plus.push(baseline)
    deka.push(baseline + (direction === 'better' ? -adjustment :
      direction === 'worse' ? adjustment : 0))
  }
  return { plus, deka }
}
function checkMoneyOracle(context, seed, direction) {
  const { plus, deka } = pricesFor(seed, direction)
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.priceContext = context
  for (let i = 0; i < 11; i++) {
    sheet.baseline.lines[i].observedProduct.priceCents = plus[i]
    sheet.candidate.lines[i].observedProduct.priceCents = deka[i]
  }
  const before = JSON.stringify(sheet)
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(JSON.stringify(sheet), before)
  const sumPlus = plus.reduce((a, b) => a + b, 0)
  const sumDeka = deka.reduce((a, b) => a + b, 0)
  const delta = sumDeka - sumPlus
  assert.equal(report.priceContext, context)
  assert.equal(report.privateOnly, true)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.knownSubtotalsCents.incompleteBasket, false)
  assert.equal(report.knownSubtotalsCents.plus, sumPlus)
  assert.equal(report.knownSubtotalsCents.dekamarkt, sumDeka)
  assert.equal(report.comparableLineCount, 11)
  assert.equal(report.unmatchedLineCount, 0)
  assert.equal(report.fullBasket.comparable, true)
  assert.equal(report.fullBasket.outcome, direction)
  assert.equal(report.fullBasket.plusTotalCents, sumPlus)
  assert.equal(report.fullBasket.dekamarktTotalCents, sumDeka)
  assert.equal(report.fullBasket.deltaCents, delta)
  assert.equal(report.fullBasket.provisionalSavingsCents, -delta)
  const reportBeforeRender = JSON.stringify(report)
  const html = renderPrivateM3ProductComparisonHtml(report)
  const csv = renderPrivateM3ComparisonCsv(report)
  assert.equal(JSON.stringify(report), reportBeforeRender)
  assert.match(html, /NIET onafhankelijk geverifieerd|Niet onafhankelijk geverifieerd|niet onafhankelijk geverifieerd/i)
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const rows = csv.slice(1).trimEnd().split('\r\n').map(row => row.split(';').map(unquote))
  assert.equal(rows.length, 14)
  for (const row of rows.slice(1)) assert.equal(row.length, 19)
  assert.equal(rows[0][0], 'PRIVE / NIET GEVERIFIEERD')
  assert.equal(rows[13][0], 'VOORLOPIGE VOLLEDIGE MAND')
  assert.equal(rows[13][9], money(sumPlus))
  assert.equal(rows[13][16], money(sumDeka))
  assert.equal(rows[13][17], money(delta))
  for (let i = 0; i < 11; i++) {
    const line = report.lines[i]
    assert.equal(line.plus.lineTotalCents, plus[i])
    assert.equal(line.dekamarkt.lineTotalCents, deka[i])
    assert.equal(line.provisionalLineDeltaCents, deka[i] - plus[i])
    assert.equal(rows[i + 2][8], money(plus[i]))
    assert.equal(rows[i + 2][9], money(plus[i]))
    assert.equal(rows[i + 2][15], money(deka[i]))
    assert.equal(rows[i + 2][16], money(deka[i]))
    assert.equal(rows[i + 2][17], money(deka[i] - plus[i]))
  }
}
test('M3 768 variable-price two-store fictional baskets preserve 22-row money and CSV columns', () => {
  let count = 0
  for (const context of ['in-store','online-order'])
    for (const direction of ['better','same','worse'])
      for (let seed = 1; seed <= 128; seed++) {
        checkMoneyOracle(context, seed * 2654435761, direction)
        count++
      }
  assert.equal(count, 768)
})
