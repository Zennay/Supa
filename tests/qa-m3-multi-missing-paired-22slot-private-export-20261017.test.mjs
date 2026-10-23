import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Additive QA-only coverage. Unlike the merged single-missing controls,
// these scenarios systematically cross *simultaneous* missing physical packs,
// including both retailers missing the SAME ingredient. Pure fictional data.
const contexts = ['in-store', 'online-order']
const staleCents = 777777
const positions = Array.from({ length: 22 }, (_, index) => ({
  side: index < 11 ? 'baseline' : 'candidate',
  row: index % 11,
}))
function evaluate(context, absent) {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.priceContext = context
  const missing = new Set(absent)
  for (const id of missing) {
    const { side, row } = positions[id]
    // Keep stale once-observed cents and name deliberately; availability
    // false must beat any saved historic financial-looking information.
    sheet[side].lines[row].observedProduct.priceCents = staleCents
    sheet[side].lines[row].observedProduct.available = false
  }
  const before = JSON.stringify(sheet)
  const report = buildPrivateM3ProductComparison(sheet)
  assert.equal(JSON.stringify(sheet), before, 'converter mutated private observation')
  assert.equal(report.priceContext, context)
  assert.equal(report.privateOnly, true)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.fullBasket.comparable, false)
  assert.equal(report.fullBasket.outcome, 'unknown')
  for (const field of ['plusTotalCents', 'dekamarktTotalCents', 'deltaCents', 'provisionalSavingsCents']) {
    assert.equal(report.fullBasket[field], null, 'no price winner on partial physical basket: ' + field)
  }
  const absentPlus = absent.filter(id => id < 11).length
  const absentDeka = absent.length - absentPlus
  assert.equal(report.knownSubtotalsCents.plus, (11 - absentPlus) * 100)
  assert.equal(report.knownSubtotalsCents.dekamarkt, (11 - absentDeka) * 90)
  assert.equal(report.knownSubtotalsCents.incompleteBasket, true)
  let comparable = 0
  for (let i = 0; i < 11; i++) {
    const line = report.lines[i]
    const baselineAbsent = missing.has(i)
    const candidateAbsent = missing.has(i + 11)
    assert.equal(line.plus.status, baselineAbsent ? 'unresolved' : 'known')
    assert.equal(line.dekamarkt.status, candidateAbsent ? 'unresolved' : 'known')
    const both = !baselineAbsent && !candidateAbsent
    if (both) comparable++
    assert.equal(line.provisionalLineDeltaCents, both ? -10 : null)
    if (baselineAbsent) assert.equal(line.plus.lineTotalCents, null)
    if (candidateAbsent) assert.equal(line.dekamarkt.lineTotalCents, null)
  }
  assert.equal(report.comparableLineCount, comparable)
  assert.equal(report.unmatchedLineCount, 11 - comparable)
  const original = JSON.stringify(report)
  const html = renderPrivateM3ProductComparisonHtml(report)
  const csv = renderPrivateM3ComparisonCsv(report)
  assert.equal(JSON.stringify(report), original, 'renderers mutated report')
  assert.equal((html.match(/<tr><th scope="row">/gu) ?? []).length, 11)
  assert.match(html, /Nog geen betrouwbare winnaar/)
  assert.match(html, /Bekende deeltotalen/)
  assert.doesNotMatch(html, /is goedkoper voor dit volledige gemeten mandje/)
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const rows = csv.slice(1).trimEnd().split('\r\n')
  assert.equal(rows.length, 14)
  for (const row of rows.slice(1)) assert.equal(row.split(';').length, 19)
  assert.match(rows[13], /VOLLEDIGE MAND ONBEKEND/)
  assert.doesNotMatch(csv, /VOORLOPIGE VOLLEDIGE MAND/)
  // The only unusually high cents were stale *unavailable* prices and must
  // never reach either view or money summaries.
  assert.equal(JSON.stringify(report).includes(String(staleCents)), false)
  assert.equal((html + csv).includes('7777,77'), false)
}
test('M3 every unordered pair of absent PLUS/Deka physical pack slots stays nonclaimable', () => {
  let cases = 0
  for (const context of contexts) for (let a = 0; a < 22; a++) for (let b = a + 1; b < 22; b++) {
    evaluate(context, [a, b])
    cases++
  }
  assert.equal(cases, 462)
})
test('M3 all-unknown and one-entire-store-unknown cannot become a complete basket', () => {
  let cases = 0
  for (const context of contexts) for (const absent of [
    positions.map((_, index) => index),
    positions.map((_, index) => index).filter(index => index < 11),
    positions.map((_, index) => index).filter(index => index >= 11),
  ]) {
    evaluate(context, absent)
    cases++
  }
  assert.equal(cases, 6)
})
