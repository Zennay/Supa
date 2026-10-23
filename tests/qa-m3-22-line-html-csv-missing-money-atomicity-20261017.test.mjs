import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Human M3 field runs carry 11 identical ingredient needs at TWO stores.
// Deliberately fictional product cents: these must NEVER become real prices,
// a retailer license or an independently verified public savings claim.
const privateMarker = 'PRIVATE_FAKE_OPERATOR_DONT_EXPORT_20261017'
const unknownProduct = {
  productId: '', productName: '', packAmount: null, packUnit: null,
  packCount: 1, priceCents: null, available: false, sourceUrl: '', note: '',
}

function footerColumns(csv) {
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines.length, 14)
  const cols = lines.at(-1).slice(1, -1).split('";"')
  assert.equal(cols.length, 19)
  return cols
}

function assertPrivateArtifacts(report, html, csv, context) {
  assert.equal(report.privateOnly, true, context)
  assert.equal(report.verifiedRetailerObservations, false, context)
  assert.equal(report.publicSavingsClaimEligible, false, context)
  assert.match(html, /Niet onafhankelijk geverifieerd/, context)
  assert.match(csv, /PRIVE \/ NIET GEVERIFIEERD/, context)
  assert.match(csv, /Geen actuele prijsfeed en geen publieke besparingsclaim/, context)
  assert.equal((html.match(/<tr><th scope="row">/g) ?? []).length, 11, context)
  assert.equal(csv.split('\r\n').length, 15, '14 content lines + terminal CRLF')
  assert.doesNotMatch(html + csv, /PRIVATE_FAKE_OPERATOR_DONT_EXPORT_20261017|participantKey|sourceUrl|provenanceNote|evidenceId/i, context)
}

test('positive 11x2 fully priced fictional field: all better/equal/worse outcomes agree in both private renderers', () => {
  for (const [price, outcome, delta] of [
    [90, 'better', '-1,10'], [100, 'same', '0,00'], [110, 'worse', '1,10'],
  ]) {
    const sheet = buildFictionalPricedSheet(price)
    sheet.study.population = privateMarker
    const before = structuredClone(sheet)
    const report = buildPrivateM3ProductComparison(sheet)
    const html = renderPrivateM3ProductComparisonHtml(report)
    const csv = renderPrivateM3ComparisonCsv(report)
    assertPrivateArtifacts(report, html, csv, outcome)
    assert.equal(report.fullBasket.comparable, true)
    assert.equal(report.fullBasket.outcome, outcome)
    assert.equal(report.comparableLineCount, 11)
    assert.equal(report.unmatchedLineCount, 0)
    assert.equal(footerColumns(csv)[0], 'VOORLOPIGE VOLLEDIGE MAND')
    assert.equal(footerColumns(csv)[17], delta)
    assert.deepEqual(sheet, before, outcome + ': original private capture remains immutable')
  }
})

test('66 full-path missing-line cases: any one of 22 store rows must block full-basket claims in both renderers', () => {
  let verified = 0
  for (const candidatePrice of [90, 100, 110]) {
    for (const side of ['baseline', 'candidate']) {
      for (let index = 0; index < 11; index++) {
        const sheet = buildFictionalPricedSheet(candidatePrice)
        sheet.study.population = privateMarker
        sheet[side].lines[index].observedProduct = { ...unknownProduct }
        const before = structuredClone(sheet)
        const report = buildPrivateM3ProductComparison(sheet)
        const html = renderPrivateM3ProductComparisonHtml(report)
        const csv = renderPrivateM3ComparisonCsv(report)
        const key = `candidatePrice=${candidatePrice},side=${side},index=${index}`
        assertPrivateArtifacts(report, html, csv, key)
        assert.equal(report.fullBasket.comparable, false, key)
        assert.equal(report.fullBasket.outcome, 'unknown', key)
        assert.equal(report.fullBasket.deltaCents, null, key)
        assert.equal(report.fullBasket.provisionalSavingsCents, null, key)
        assert.equal(report.comparableLineCount, 10, key)
        assert.equal(report.unmatchedLineCount, 1, key)
        const foot = footerColumns(csv)
        assert.equal(foot[0], 'VOLLEDIGE MAND ONBEKEND', key)
        assert.equal(foot[9], '', key)
        assert.equal(foot[16], '', key)
        assert.equal(foot[17], '', key)
        assert.match(html, /Nog geen betrouwbare winnaar/, key)
        assert.doesNotMatch(html, /gemeten mandje \(voorlopig\)/, key)
        assert.equal(csv.split('\r\n').filter(row => row.includes('"Voorlopig vergelijkbaar"')).length, 10, key)
        assert.equal(csv.split('\r\n').filter(row => row.includes('"Onbekend / niet volledig"')).length, 1, key)
        assert.deepEqual(sheet, before, key + ': original evidence not rewritten')
        verified++
      }
    }
  }
  assert.equal(verified, 66)
})
