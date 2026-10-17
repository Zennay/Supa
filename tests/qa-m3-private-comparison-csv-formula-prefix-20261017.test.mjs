import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Offline fictional M3 evidence, not a genuine PLUS/Deka price or an
// actual spreadsheet execution claim. The exported, quoted CSV text must
// not contain visually hidden formula-like cells in either retailer column.
function comparison() {
  const report = buildPrivateM3ProductComparison(buildFictionalPricedSheet(90))
  assert.equal(report.lines.length, 11)
  assert.equal(report.fullBasket.comparable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  return report
}

function productCell(csv, side) {
  // Every synthetic label lacks delimiters/quotes; field separator and
  // 19-column header are separately asserted before reading product cells.
  const lines = csv.replace(/^\ufeff/u, '').split('\r\n')
  assert.equal(lines[1].split(';').length, 19)
  assert.equal(lines[2].split(';').length, 19)
  return lines[2].split(';')[side === 'plus' ? 3 : 10]
}

function requireSpreadsheetSafe(input, side) {
  const report = comparison()
  report.lines[0][side].productName = input
  const originalTotal = { ...report.fullBasket }
  const raw = JSON.stringify(report)
  let csv
  try {
    csv = renderPrivateM3ComparisonCsv(report)
  } catch (error) {
    assert.doesNotMatch(String(error), /QA_SECRET_CANARY/u,
      'refusal must not echo fictional field value')
    assert.equal(JSON.stringify(report), raw, 'refusal must not alter financial evidence')
    return
  }
  const cell = productCell(csv, side)
  assert.ok(cell.startsWith('"\''),
    'formula-shaped retailer text needs a literal-text guard or refusal; got '+JSON.stringify(cell))
  assert.equal(JSON.stringify(report), raw, 'encoding cannot alter the private comparison')
  assert.deepEqual(report.fullBasket, originalTotal, 'CSV must never change basket arithmetic')
  assert.equal(report.publicSavingsClaimEligible, false)
}

test('M3 baseline: plain names survive private CSV and are not forced into formulas', () => {
  const report = comparison()
  report.lines[0].plus.productName = 'Fictional apples 500 gram'
  report.lines[0].dekamarkt.productName = 'Fictional pears 500 gram'
  const csv = renderPrivateM3ComparisonCsv(report)
  assert.equal(productCell(csv, 'plus'), '"Fictional apples 500 gram"')
  assert.equal(productCell(csv, 'dekamarkt'), '"Fictional pears 500 gram"')
  assert.match(csv, /PRIVE \/ NIET GEVERIFIEERD/u)
})

test('M3 baseline: ASCII formula markers are quoted as literal text for both stores', () => {
  for (const side of ['plus', 'dekamarkt']) {
    for (const prefix of ['=', '+', '-', '@', '  =', '\u200b=']) {
      requireSpreadsheetSafe(prefix + '1+1', side)
    }
  }
})

const invisiblePrefixes = [
  ['WORD JOINER', '\u2060'],
  ['LEFT-TO-RIGHT MARK', '\u200e'],
  ['RIGHT-TO-LEFT MARK', '\u200f'],
  ['LEFT-TO-RIGHT EMBEDDING', '\u202a'],
  ['RIGHT-TO-LEFT OVERRIDE', '\u202e'],
  ['LEFT-TO-RIGHT ISOLATE', '\u2066'],
  ['POP DIRECTIONAL ISOLATE', '\u2069'],
  ['COMBINING GRAPHEME JOINER', '\u034f'],
  ['SOFT HYPHEN', '\u00ad'],
  ['MONGOLIAN VOWEL SEPARATOR', '\u180e'],
  ['VARIATION SELECTOR-16', '\ufe0f'],
]
for (const [label, prefix] of invisiblePrefixes) {
  test('M3 CSV guard: invisible '+label+' cannot camouflage formula in PLUS or Deka', () => {
    for (const side of ['plus', 'dekamarkt']) {
      requireSpreadsheetSafe(prefix + '=1+1', side)
    }
  })
}

test('M3 CSV guard: compatibility formula-width aliases cannot appear unguarded', () => {
  for (const codePoint of ['＝', '﹦', '＋', '﹢', '－', '﹣', '＠']) {
    for (const side of ['plus', 'dekamarkt']) {
      requireSpreadsheetSafe(codePoint + '1+1', side)
    }
  }
})
