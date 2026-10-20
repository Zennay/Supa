import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Fully fictional human field observations. Independent physical pack-count
// oracle: varying single packs and 2-unit multipacks, all 11 ingredients,
// both stores and two order contexts. No online fetch or verified money claim.
const money = cents => {
  const value = BigInt(cents)
  const sign = value < 0n ? '-' : ''
  const magnitude = value < 0n ? -value : value
  return sign + String(magnitude / 100n) + ',' + String(magnitude % 100n).padStart(2, '0')
}
function assertCsvMoney(raw, cents, label) {
  assert.equal(raw, '"' + money(cents) + '"', label)
}
function oracle(seed, context) {
  let state = seed >>> 0
  function next() {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.priceContext = context
  const expected = { baseline: [], candidate: [] }
  for (const side of ['baseline','candidate']) for (let i = 0; i < 11; i++) {
    const line = sheet[side].lines[i]
    const factors = line.requirement.unit === 'piece' ? [1, 2] : [1, 2, 4]
    const divisor = factors[next() % factors.length]
    const unitsPerPack = 1 + next() % 2
    const price = 1 + next() % 400
    // The observed physical pack covers unitsPerPack × (requirement/divisor).
    // Therefore the independently expected number of paid packs is
    // ceil(divisor / unitsPerPack), without using any product source function.
    const packages = Math.ceil(divisor / unitsPerPack)
    const product = line.observedProduct
    product.packAmount = line.requirement.amount / divisor
    product.packCount = unitsPerPack
    product.priceCents = price
    expected[side].push({ packages, price, total: packages * price, divisor, unitsPerPack })
  }
  const inputSnapshot = JSON.stringify(sheet)
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(JSON.stringify(sheet), inputSnapshot, 'physical sheet mutation')
  const plus = expected.baseline.reduce((acc, item) => acc + item.total, 0)
  const deka = expected.candidate.reduce((acc, item) => acc + item.total, 0)
  assert.equal(report.privateOnly, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.fullBasket.comparable, true)
  assert.equal(report.fullBasket.plusTotalCents, plus)
  assert.equal(report.fullBasket.dekamarktTotalCents, deka)
  assert.equal(report.fullBasket.deltaCents, deka - plus)
  assert.equal(report.fullBasket.provisionalSavingsCents, plus - deka === 0 ? 0 : plus - deka)
  assert.equal(report.knownSubtotalsCents.plus, plus)
  assert.equal(report.knownSubtotalsCents.dekamarkt, deka)
  assert.equal(report.knownSubtotalsCents.incompleteBasket, false)
  const reportSnapshot = JSON.stringify(report)
  const html = renderPrivateM3ProductComparisonHtml(report)
  const csv = renderPrivateM3ComparisonCsv(report)
  assert.ok(html.includes('PLUS'), 'private HTML includes correct retailer')
  assert.equal(JSON.stringify(report), reportSnapshot)
  const rows = csv.slice(1).trimEnd().split('\r\n').map(row => row.split(';'))
  assert.equal(rows.length, 14)
  assert.equal(rows[13].length, 19)
  assertCsvMoney(rows[13][9], plus, 'PLUS physical full total')
  assertCsvMoney(rows[13][16], deka, 'Deka physical full total')
  assertCsvMoney(rows[13][17], deka - plus, 'correct store delta')
  for (let i = 0; i < 11; i++) {
    const line = report.lines[i]
    const p = expected.baseline[i]
    const d = expected.candidate[i]
    assert.equal(line.plus.status, 'known')
    assert.equal(line.dekamarkt.status, 'known')
    assert.equal(line.plus.packages, p.packages)
    assert.equal(line.dekamarkt.packages, d.packages)
    assert.equal(line.plus.itemsPerPackage, p.unitsPerPack)
    assert.equal(line.dekamarkt.itemsPerPackage, d.unitsPerPack)
    assert.equal(line.plus.pricePerPackageCents, p.price)
    assert.equal(line.dekamarkt.pricePerPackageCents, d.price)
    assert.equal(line.plus.lineTotalCents, p.total)
    assert.equal(line.dekamarkt.lineTotalCents, d.total)
    assert.equal(line.provisionalLineDeltaCents, d.total - p.total)
    const cells = rows[i + 2]
    assert.equal(cells.length, 19)
    assert.equal(cells[7], '"' + p.packages + '"')
    assert.equal(cells[14], '"' + d.packages + '"')
    assertCsvMoney(cells[8], p.price, 'PLUS physical per-pack price')
    assertCsvMoney(cells[9], p.total, 'PLUS physical row total')
    assertCsvMoney(cells[15], d.price, 'Deka physical per-pack price')
    assertCsvMoney(cells[16], d.total, 'Deka physical row total')
    assertCsvMoney(cells[17], d.total - p.total, 'physical row delta')
  }
}
test('M3 512 multi-pack varied physical price/quantity matrices retain exact private cents', () => {
  let cases = 0
  for (const context of ['in-store','online-order'])
    for (let sample = 1; sample <= 256; sample++) {
      oracle(Math.imul(sample, 2654435761), context)
      cases++
    }
  assert.equal(cases, 512)
})
