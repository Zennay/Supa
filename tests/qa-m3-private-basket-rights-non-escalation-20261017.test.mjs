import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { renderPrivateM3ProductComparisonHtml } from '../scripts/m3-private-comparison-html.mjs'
import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

// A technically complete 11+11 synthetic human basket is NOT a retailer-data
// license. The actual checked-in rights record must still prevent transport.
// The injected function cannot reach retailer HTTP under denied rights.
const rights = JSON.parse(await readFile(new URL(
  '../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
const urls = {
  plus: {
    product: 'https://www.plus.nl/product/fictional-qa-no-item-20261017',
    catalog: 'https://www.plus.nl/producten',
    offers: 'https://www.plus.nl/aanbiedingen',
  },
  dekamarkt: {
    product: 'https://www.dekamarkt.nl/producten/fictional-qa-no-item-20261017',
    catalog: 'https://www.dekamarkt.nl/producten/fictional-qa-no-list',
    offers: 'https://www.dekamarkt.nl/aanbiedingen',
  },
}

test('18 real source-gate denial paths remain closed despite fictional complete M3 cheaper/same/worse HTML+CSV', async () => {
  const beforeRights = structuredClone(rights)
  const expected = evaluateSourcePermissionGate(rights)
  assert.equal(expected.productionReady, false)
  assert.deepEqual(expected.blockers.map(x => [x.supermarket, x.permissionStatus]),
    [['plus', 'permission_required'], ['dekamarkt', 'unresolved']])

  let transportCalls = 0
  let cases = 0
  for (const candidatePrice of [90, 100, 110]) {
    const sheet = buildFictionalPricedSheet(candidatePrice)
    sheet.study.population = 'FICTIONAL_PRIVATE_RIGHTS_TEST_PERSON'
    const beforeSheet = structuredClone(sheet)
    const report = buildPrivateM3ProductComparison(sheet)
    assert.equal(report.fullBasket.comparable, true)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.verifiedRetailerObservations, false)
    const html = renderPrivateM3ProductComparisonHtml(report)
    const csv = renderPrivateM3ComparisonCsv(report)
    assert.match(html, /Niet onafhankelijk geverifieerd/)
    assert.match(csv, /Geen actuele prijsfeed en geen publieke besparingsclaim/)
    assert.doesNotMatch(html + csv, /FICTIONAL_PRIVATE_RIGHTS_TEST_PERSON/)
    assert.deepEqual(sheet, beforeSheet)

    for (const supermarket of ['plus', 'dekamarkt']) {
      for (const kind of ['product', 'catalog', 'offers']) {
        const url = urls[supermarket][kind]
        await assert.rejects(
          captureApprovedRetailerPage({
            source: { supermarket, kind, url },
            permissionGate: rights,
            grant: {
              supermarket, kind, sourceUrl: url,
              reviewed: true, termsReviewed: true,
              robotsReviewed: true, noAntiBotBypass: true,
            },
            capturedAt: new Date(Date.now() - 60_000).toISOString(),
            fetchFn: async () => {
              transportCalls++
              throw new Error('FICTIONAL_NETWORK_MUST_NOT_RUN')
            },
          }),
          /Explicit retailer source permission required/,
          `${supermarket} ${kind} ${candidatePrice}: must reject without transport`,
        )
        assert.equal(transportCalls, 0)
        cases++
      }
    }
  }
  assert.equal(cases, 18)
  assert.equal(transportCalls, 0)
  assert.deepEqual(rights, beforeRights, 'canonical source rights cannot be changed by a private human comparison')
})
