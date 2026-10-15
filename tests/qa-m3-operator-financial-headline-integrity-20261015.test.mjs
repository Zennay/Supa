import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPrivateComparison } from '../scripts/retailer-show-private-comparison.mjs'

// Independently hand-calculated fictional financial oracle. A renderable
// offline-preview envelope is not itself evidence that claimed savings are
// arithmetically compatible with its line items and physical whole packs.
function storeLine(price) {
  return { status: 'matched', packs: 1, packPriceCents: price,
    totalCents: price, productName: 'Fictional milk' }
}
function coherent() {
  return {
    format: 'supa-local-snapshot-comparison-v1',
    captureSummary: [
      { supermarket: 'plus', parsedProducts: 1 },
      { supermarket: 'dekamarkt', parsedProducts: 1 },
    ],
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      comparable: true, cheaperStore: 'dekamarkt', savingsCents: 10,
      stores: {
        plus: { complete: true, subtotalCents: 129 },
        dekamarkt: { complete: true, subtotalCents: 119 },
      },
      lines: [{
        ingredientId: 'milk', ingredient: 'fictional milk',
        plus: storeLine(129), dekamarkt: storeLine(119),
        differenceCents: -10,
      }],
    },
  }
}
function assertFinancialAbstention(report, why) {
  const before = JSON.stringify(report)
  // Either reject a forged report explicitly or render an UNKNOWN no-money
  // result, but never show an affirmative winner or per-line fictitious money.
  let text
  try {
    text = renderPrivateComparison(report)
  } catch (err) {
    assert.match(String(err), /Invalid|comparison|trust|money|offline|inconsistent/i, why)
    assert.equal(JSON.stringify(report), before, 'must not mutate caller data')
    return
  }
  assert.doesNotMatch(text, /ALLEEN OFFLINE MANDVERSCHIL:/, why)
  assert.match(text, /GEEN LIVE PRIJZEN/)
  assert.equal(JSON.stringify(report), before, 'must not mutate caller data')
}

test('QA: coherent one-pack fictional money arithmetic is still readable as OFFLINE only', () => {
  const text = renderPrivateComparison(coherent())
  assert.match(text, /PLUS: 1 × €1,29 = €1,29/)
  assert.match(text, /DekaMarkt: 1 × €1,19 = €1,19/)
  assert.match(text, /ALLEEN OFFLINE MANDVERSCHIL: DekaMarkt lager €0,10/)
  assert.match(text, /GEEN LIVE PRIJZEN/)
})

for (const [name, change] of [
  ['zero ingredient rows with asserted complete stores', f => { f.comparison.lines = [] }],
  ['one required ingredient missing but stores marked complete', f => {
    f.comparison.lines[0].dekamarkt = { status: 'unknown' }
  }],
  ['pack charge contradicts physical pack count', f => {
    f.comparison.lines[0].plus.packs = 2
  }],
  ['line amount does not equal one-pack price', f => {
    f.comparison.lines[0].dekamarkt.totalCents = 17
  }],
  ['subtotals contradict the single settled row', f => {
    f.comparison.stores.plus.subtotalCents = 1
  }],
  ['winner contradicts signed real subtotal order', f => {
    f.comparison.cheaperStore = 'plus'
  }],
  ['asserted savings contradict subtotals by 989 cents', f => {
    f.comparison.savingsCents = 999
  }],
  ['unsafe NaN pack price with fabricated complete totals', f => {
    f.comparison.lines[0].plus.packPriceCents = Number.NaN
  }],
  ['negative pack price with fabricated complete totals', f => {
    f.comparison.lines[0].dekamarkt.packPriceCents = -119
  }],
]) {
  test('QA: operator cannot print a confident offline winner when ' + name, () => {
    const report = coherent()
    change(report)
    assertFinancialAbstention(report, name)
  })
}

test('QA: forged per-line saving mismatching line totals must never be printed', () => {
  const report = coherent()
  report.comparison.lines[0].differenceCents = -999
  const before = JSON.stringify(report)
  try {
    const text = renderPrivateComparison(report)
    assert.doesNotMatch(text, /Offline regelverschil: DekaMarkt lager €9,99/,
      'a fabricated line difference cannot become operator evidence')
  } catch (error) {
    assert.match(String(error), /Invalid|comparison|trust|money|offline|inconsistent/i)
  }
  assert.equal(JSON.stringify(report), before)
})

test('QA: genuine stock uncertainty still produces a no-money result', () => {
  const report = coherent()
  report.comparison.comparable = false
  report.comparison.cheaperStore = null
  report.comparison.savingsCents = null
  report.comparison.stores.dekamarkt.complete = false
  report.comparison.lines[0].dekamarkt.status = 'availability_unknown'
  report.comparison.lines[0].differenceCents = null
  const text = renderPrivateComparison(report)
  assert.doesNotMatch(text, /ALLEEN OFFLINE MANDVERSCHIL/)
  assert.match(text, /voorraad onbekend/)
})

test('QA: marked public-claimable reports still fail closed', () => {
  const report = coherent()
  report.comparison.claimable = true
  assert.throws(() => renderPrivateComparison(report), /Invalid or claimable/)
})
