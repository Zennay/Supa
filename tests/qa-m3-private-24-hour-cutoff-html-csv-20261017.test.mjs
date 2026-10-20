import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'

// Millisecond-precise physical window acceptance for a full fictional 11x2
// human field visit. The prior 11x2 exploratory retail URL comparison does
// NOT meet this evidence bar; do not grant live rights or public savings.
const TIMESTAMPS = [
  ['23:59:59.999', '2026-10-15T09:59:59.999Z', true],
  ['exactly 24:00:00.000', '2026-10-15T10:00:00Z', true],
  ['24:00:00.001', '2026-10-15T10:00:00.001Z', false],
  ['25:00:00.000', '2026-10-15T11:00:00Z', false],
]
const privateCanary = 'FICTIONAL_M3_24H_PRIVATE_PERSON_20261017'

test('24-hour physical claim cutoff: both allowed price contexts × three basket outcomes × four millisecond clock edges', () => {
  let cases = 0
  for (const priceContext of ['in-store', 'online-order']) {
    for (const candidatePrice of [90, 100, 110]) {
      for (const [label, timestamp, withinLimit] of TIMESTAMPS) {
        const sheet = buildFictionalPricedSheet(candidatePrice)
        sheet.study.weekStart = '2026-10-12'
        sheet.study.priceContext = priceContext
        sheet.study.population = privateCanary
        sheet.baseline.observedAt = '2026-10-14T10:00:00Z'
        sheet.candidate.observedAt = timestamp
        const original = structuredClone(sheet)
        const readiness = observationSheetReadiness(sheet)
        assert.equal(readiness.ready, withinLimit, label)
        const report = buildPrivateM3ProductComparison(sheet)
        const html = renderPrivateM3ProductComparisonHtml(report)
        const csv = renderPrivateM3ComparisonCsv(report)
        const key = `${priceContext} EUR ${candidatePrice} ${label}`
        assert.equal(report.priceContext, priceContext, key)
        assert.equal(report.verifiedRetailerObservations, false, key)
        assert.equal(report.publicSavingsClaimEligible, false, key)
        assert.equal(report.fullBasket.comparable, withinLimit, key)
        assert.equal(report.fullBasket.outcome, withinLimit
          ? candidatePrice < 100 ? 'better' : candidatePrice > 100 ? 'worse' : 'same'
          : 'unknown', key)
        const footer = csv.trimEnd().split('\r\n').at(-1)
        if (withinLimit) {
          assert.equal(report.fullBasket.plusTotalCents, 1100, key)
          assert.equal(report.fullBasket.dekamarktTotalCents, 11 * candidatePrice, key)
          assert.equal(report.fullBasket.deltaCents, 11 * (candidatePrice - 100), key)
          assert.match(csv, /"VOORLOPIGE VOLLEDIGE MAND"/, key)
          assert.doesNotMatch(html, /Nog geen betrouwbare winnaar/, key)
        } else {
          assert.equal(report.fullBasket.plusTotalCents, null, key)
          assert.equal(report.fullBasket.dekamarktTotalCents, null, key)
          assert.equal(report.fullBasket.deltaCents, null, key)
          assert.equal(report.fullBasket.provisionalSavingsCents, null, key)
          assert.match(footer, /"VOLLEDIGE MAND ONBEKEND"/, key)
          assert.match(html, /Nog geen betrouwbare winnaar/, key)
          assert.doesNotMatch(csv, /"VOORLOPIGE VOLLEDIGE MAND"/, key)
        }
        assert.doesNotMatch(html + csv, /FICTIONAL_M3_24H_PRIVATE_PERSON_20261017|participantKey|provenanceNote|evidenceId/i, key)
        assert.deepEqual(sheet, original, key + ': no input mutation')
        cases++
      }
    }
  }
  assert.equal(cases, 24)
})
