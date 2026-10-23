import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

// All requests are INERT: injected fetchFn throws if invoked. These URLs
// describe fictional paths that happen to be under retailer allowlists;
// they are NEVER fetched. The genuine rights registry remains denied.
const REGISTRY = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const DENIALS = ['permission_required', 'unresolved', 'prohibited']
const ROUTES = {
  plus: {
    product: 'https://www.plus.nl/product/qa-fictional-no-item-20261017',
    catalog: 'https://www.plus.nl/producten',
    offers: 'https://www.plus.nl/aanbiedingen',
  },
  dekamarkt: {
    product: 'https://www.dekamarkt.nl/producten/qa-fictional-no-item-20261017',
    catalog: 'https://www.dekamarkt.nl/producten/qa-fictional-no-list',
    offers: 'https://www.dekamarkt.nl/aanbiedingen',
  },
}

async function canonicalRights() {
  return JSON.parse(await readFile(REGISTRY, 'utf8'))
}

for (const retailer of ['plus', 'dekamarkt']) {
  test('M3 fail-closed transport: ' + retailer +
    ' denies all 36 combinations of permission, enabled flag and fictional grant', async () => {
    const official = await canonicalRights()
    let checked = 0
    let transportCalls = 0

    for (const status of DENIALS) {
      for (const enabled of [false, true]) {
        for (const hasFictionalGrant of [false, true]) {
          const rights = structuredClone(official)
          const row = rights.sources.find(x => x.supermarket === retailer)
          row.permissionStatus = status
          row.productionEnabled = enabled
          if (hasFictionalGrant) {
            row.evidence.push({
              kind: 'written_permission',
              url: 'https://example.invalid/fictional-qa-rights-only',
              finding: 'Test-only synthetic text; this is never real retailer permission.',
            })
          }

          for (const [kind, url] of Object.entries(ROUTES[retailer])) {
            const label = JSON.stringify({ retailer, status, enabled, hasFictionalGrant, kind })
            const before = JSON.stringify(rights)
            await assert.rejects(
              captureApprovedRetailerPage({
                source: { supermarket: retailer, kind, url },
                permissionGate: rights,
                grant: {
                  supermarket: retailer, kind, sourceUrl: url,
                  reviewed: true, termsReviewed: true,
                  robotsReviewed: true, noAntiBotBypass: true,
                },
                capturedAt: '2026-10-17T00:00:00.000Z',
                fetchFn: async () => {
                  transportCalls++
                  throw Error('UNAUTHORIZED_RETAILER_NETWORK_MUST_NEVER_RUN')
                },
              }),
              /production ingestion must stay disabled|Explicit retailer source permission required/,
              'a valid URL and a syntactically reviewed one-page grant never overcome denied rights: ' + label,
            )
            assert.equal(transportCalls, 0, 'absolutely no HTTP-like transport for ' + label)
            assert.equal(JSON.stringify(rights), before,
              'permission registry must remain byte-identical after refusal: ' + label)
            checked++
          }
        }
      }
    }
    assert.equal(checked, 36)
    assert.equal(transportCalls, 0)
  })
}

test('M3 actual source registry never contains explicit production consent for either retailer', async () => {
  const registry = await canonicalRights()
  for (const retailer of ['plus', 'dekamarkt']) {
    const row = registry.sources.find(source => source.supermarket === retailer)
    assert.ok(row, retailer)
    assert.notEqual(row.permissionStatus, 'permitted')
    assert.equal(row.productionEnabled, false)
    assert.ok(row.evidence.length > 0)
    assert.ok(row.evidence.every(item =>
      !['written_permission', 'official_license'].includes(item.kind)))
  }
})
