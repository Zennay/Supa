import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Independent offline QA oracle. The private comparison must aggregate exact
// cents across all 11 observed physical demands, rather than vote by the count
// of cheaper line items. Asymmetric 79/142 vs baseline 100 proves that a
// majority of cheap items can still lose the whole basket. The separate
// even-size 10-row 80/120 grid plus one 100-cent neutral row covers ties.
// All prices are fictional; neither retailer data nor source rights are used.
const format = cents => {
  const abs = Math.abs(cents)
  return (cents < 0 ? '-' : '') + Math.floor(abs / 100) + ',' +
    String(abs % 100).padStart(2, '0')
}

function check(context, mask, length, lowPrice, highPrice) {
  const sheet = buildFictionalPricedSheet(100)
  sheet.study.priceContext = context
  let candidateTotal = 0
  let cheaperLines = 0
  for (let i = 0; i < 11; i++) {
    const p = i === length ? 100 :
      (mask & (1 << i)) !== 0 ? lowPrice : highPrice
    // For the 11-row run length=11; for the 10-row run, row #11 is neutral.
    sheet.candidate.lines[i].observedProduct.priceCents = p
    candidateTotal += p
    cheaperLines += p < 100 ? 1 : 0
  }
  const initial = JSON.stringify(sheet)
  const result = buildPrivateM3ProductComparison(sheet)
  assert.equal(JSON.stringify(sheet), initial, 'input must remain untouched')
  assert.equal(result.priceContext, context)
  assert.equal(result.privateOnly, true)
  assert.equal(result.verifiedRetailerObservations, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.comparableLineCount, 11)
  assert.equal(result.unmatchedLineCount, 0)
  assert.equal(result.fullBasket.comparable, true)
  assert.equal(result.fullBasket.plusTotalCents, 1100)
  assert.equal(result.fullBasket.dekamarktTotalCents, candidateTotal)
  const difference = candidateTotal - 1100
  const expected = difference < 0 ? 'better' : difference > 0 ? 'worse' : 'same'
  assert.equal(result.fullBasket.outcome, expected)
  assert.equal(result.fullBasket.deltaCents, difference)
  assert.equal(result.fullBasket.provisionalSavingsCents, difference === 0 ? 0 : -difference)
  assert.equal(result.knownSubtotalsCents.incompleteBasket, false)
  assert.equal(result.knownSubtotalsCents.plus, 1100)
  assert.equal(result.knownSubtotalsCents.dekamarkt, candidateTotal)

  const frozen = JSON.stringify(result)
  const html = renderPrivateM3ProductComparisonHtml(result)
  const csv = renderPrivateM3ComparisonCsv(result)
  assert.equal(JSON.stringify(result), frozen, 'renderer must not mutate report')
  assert.match(html, /Niet onafhankelijk geverifieerd/u)
  assert.match(csv, /PRIVE \/ NIET GEVERIFIEERD/u)
  assert.equal((html.match(/<tr><th scope="row">/gu) || []).length, 11)
  const rows = csv.slice(1).trimEnd().split('\r\n')
  assert.equal(rows.length, 14)
  const footer = rows[13].slice(1, -1).split('";"')
  assert.equal(footer.length, 19)
  assert.equal(footer[0], 'VOORLOPIGE VOLLEDIGE MAND')
  assert.equal(footer[9], format(1100))
  assert.equal(footer[16], format(candidateTotal))
  assert.equal(footer[17], format(difference))
  assert.match(footer[18], /niet onafhankelijk geverifieerd/u)
  assert.equal(result.lines.filter(row => row.provisionalLineDeltaCents < 0).length,
    cheaperLines)
  for (let i = 0; i < 11; i++) {
    const row = result.lines[i]
    assert.equal(row.plus.pricePerPackageCents, 100)
    assert.equal(row.dekamarkt.lineTotalCents,
      sheet.candidate.lines[i].observedProduct.priceCents)
    assert.equal(row.provisionalLineDeltaCents,
      row.dekamarkt.lineTotalCents - row.plus.lineTotalCents)
    const cells = rows[i + 2].slice(1, -1).split('";"')
    assert.equal(cells.length, 19)
    assert.equal(cells[9], format(100))
    assert.equal(cells[16], format(row.dekamarkt.lineTotalCents))
    assert.equal(cells[17], format(row.provisionalLineDeltaCents))
  }
  if (expected === 'better') assert.match(html, /DekaMarkt is goedkoper/u)
  if (expected === 'worse') assert.match(html, /PLUS is goedkoper/u)
  if (expected === 'same') assert.match(html, /kosten evenveel/u)
  return { expected, cheaperLines }
}

for (const context of ['in-store', 'online-order']) {
  test('M3 all 2048 asymmetric cheaper-item votes use exact full-basket cents: ' + context, () => {
    const counts = { better: 0, worse: 0, same: 0 }
    let majorityCheaperButWorse = 0
    for (let mask = 0; mask < 2048; mask++) {
      const result = check(context, mask, 11, 79, 142)
      counts[result.expected]++
      if (result.cheaperLines >= 6 && result.expected === 'worse') {
        majorityCheaperButWorse++
      }
    }
    assert.equal(Object.values(counts).reduce((a, b) => a + b), 2048)
    assert.ok(counts.better > 0 && counts.worse > 0)
    assert.ok(majorityCheaperButWorse > 0,
      'majority of cheaper products must not override actual basket cost')
  })
  test('M3 all 1024 balanced ten-row price masks preserve true price ties: ' + context, () => {
    const counts = { better: 0, worse: 0, same: 0 }
    for (let mask = 0; mask < 1024; mask++) {
      const result = check(context, mask, 10, 80, 120)
      counts[result.expected]++
    }
    assert.ok(counts.better > 0 && counts.worse > 0 && counts.same > 0)
    assert.equal(counts.same, 252, 'exactly C(10,5) tie combinations')
    assert.equal(Object.values(counts).reduce((a, b) => a + b), 1024)
  })
}
