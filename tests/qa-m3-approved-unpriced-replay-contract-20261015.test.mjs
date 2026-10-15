import test from 'node:test'
import assert from 'node:assert/strict'
import { runApprovedRetailerComparison } from '../scripts/retailer-approved-pipeline.mjs'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Fully fictional mock transport. Test permission is NOT retail permission.
const NOW = Date.parse('2026-10-15T11:00:00Z')
const rights = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-15',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission', url: 'https://example.org/test-only',
      finding: 'Mock-only, not a retail license.' }],
  })),
}
const product = {
  '@type': 'Product', sku: 'fictional-milk', name: 'Halfvolle melk',
  weight: { value: '1000 ml' },
}
const html = p => '<script type="application/ld+json">' + JSON.stringify(p) + '</script>'
const noPrice = html({
  ...product, offers: { '@type': 'Offer', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
})
const rangeOnly = html({
  ...product, offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR',
    lowPrice: '0.59', highPrice: '1.99' },
})
const exactPrice = html({
  ...product, offers: { '@type': 'Offer', price: '1.29',
    priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
})
const noProduct = '<html><body>Fictional upstream unavailable</body></html>'
const requirements = [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }]

function transport(pageForUrl) {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push(url)
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    return {
      url, status: 200, ok: true,
      headers: { get(name) { return name === 'content-type' ? 'text/html' : null } },
      body: new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(pageForUrl(url)))
        controller.close()
      } }),
    }
  }
  return { fetchImpl, seen }
}
const run = (t, enableLive = true) => runApprovedRetailerComparison({
  requirements, permissionDocument: rights, enableLive,
  fetchImpl: t.fetchImpl, nowMs: NOW,
})
function assertNoMoney(r, productCount) {
  assert.equal(r.claimable, false)
  assert.equal(r.comparison.claimable, false)
  assert.equal(r.comparison.comparable, false)
  assert.equal(r.comparison.cheaperStore, null)
  assert.equal(r.comparison.savingsCents, null)
  assert.deepEqual(r.captureSummary.map(row => row.extractedProducts), productCount)
}

for (const [name, page] of [
  ['missing Offer price', noPrice],
  ['AggregateOffer range', rangeOnly],
]) {
  test('parser has one Product but no checkout pack price: ' + name, () => {
    const source = SOURCES.find(row => row.id === 'plus-product-halfvolle-melk')
    const parsed = parseOfflineRetailerSnapshot({
      source, html: page, capturedAt: '2026-10-15T11:00:00Z',
    })
    assert.equal(parsed.observations.length, 1)
    assert.equal(parsed.observations[0].currentPriceCents, null)
  })
  test('identical UNPRICED Product HTML in both mocked retailers must abstain: ' +
    name, async () => {
    const t = transport(() => page)
    const r = await run(t)
    assert.equal(t.seen.length, 2)
    assertNoMoney(r, [1, 1])
    assert.equal(r.captureSummary[0].sha256, r.captureSummary[1].sha256)
  })
}

test('repeated Product-free mock HTML returns no-money preview', async () => {
  const t = transport(() => noProduct)
  assertNoMoney(await run(t), [0, 0])
  assert.equal(t.seen.length, 2)
})

test('repeated PRICED Product HTML remains forbidden', async () => {
  const t = transport(() => exactPrice)
  await assert.rejects(run(t), /Duplicate priced retailer capture across sources/)
  assert.equal(t.seen.length, 2)
})

test('distinct mock checkout prices retain separate hashes and no public claim', async () => {
  const t = transport(url => url.includes('www.plus.nl')
    ? exactPrice : exactPrice.replace('1.29', '1.19'))
  const r = await run(t)
  assert.equal(r.claimable, false)
  assert.notEqual(r.captureSummary[0].sha256, r.captureSummary[1].sha256)
  assert.equal(t.seen.length, 2)
})

test('disabled capture never invokes mock transport', async () => {
  const t = transport(() => exactPrice)
  await assert.rejects(run(t, false), /disabled/)
  assert.equal(t.seen.length, 0)
})
