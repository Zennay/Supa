import test from 'node:test'
import assert from 'node:assert/strict'
import { runApprovedRetailerComparison } from '../scripts/retailer-approved-pipeline.mjs'

// Purely fictional retailer transports, source rights and prices.
// No actual HTTP, no external proxy, no production permission or savings claim.
const when = Date.parse('2026-10-15T11:00:00Z')
const rights = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-15',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.org/fictional-rights-only',
      finding: 'Test mock. No real retailer permission granted.' }],
  })),
}
const requirements = [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }]
const productHtml = (price = '1.29') => '<script type="application/ld+json">' +
  JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'Halfvolle melk', sku: 'synthetic-milk',
    weight: { value: '1000 ml' },
    offers: { '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' },
  }) + '</script>'
const noProduct = '<html><body>Mock retailer unavailable</body></html>'

function mockedTransport(chooseBody) {
  let calls = 0
  const fetchImpl = async (url, init) => {
    calls++
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.headers.authorization, undefined)
    const html = chooseBody(url)
    const content = new TextEncoder().encode(html)
    return {
      url, status: 200, ok: true,
      headers: { get(name) { return name === 'content-type' ? 'text/html' : null } },
      body: new ReadableStream({ start(controller) {
        controller.enqueue(content)
        controller.close()
      } }),
    }
  }
  return { fetchImpl, calls: () => calls }
}

const run = (transport, enableLive = true) => runApprovedRetailerComparison({
  requirements, permissionDocument: rights, enableLive,
  fetchImpl: transport.fetchImpl, nowMs: when,
})

test('two identical priced Product captures cannot become independent M3 retailer evidence', async () => {
  const transport = mockedTransport(() => productHtml())
  await assert.rejects(run(transport), /Duplicate priced retailer capture across sources/)
  assert.equal(transport.calls(), 2, 'no retries, proxy fallback or third source')
})

test('same Product capture copied with different string instances is still a replay', async () => {
  const transport = mockedTransport(() => String(productHtml('2.49')))
  await assert.rejects(run(transport), /Duplicate priced retailer capture across sources/)
  assert.equal(transport.calls(), 2)
})

test('identical non-product responses keep a safe unknown-price result', async () => {
  const transport = mockedTransport(() => noProduct)
  const result = await run(transport)
  assert.equal(transport.calls(), 2)
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.comparable, false)
  assert.equal(result.comparison.cheaperStore, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.captureSummary.map(v => v.extractedProducts), [0, 0])
})

test('distinct mocked Product snapshots retain separate source provenance', async () => {
  const transport = mockedTransport(url =>
    url.includes('www.plus.nl') ? productHtml('1.29') : productHtml('1.19'))
  const result = await run(transport)
  assert.equal(transport.calls(), 2)
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.captureSummary.length, 2)
  assert.notEqual(result.captureSummary[0].sha256, result.captureSummary[1].sha256)
})

test('disabled collection sends no mock request even with synthetic rights', async () => {
  const transport = mockedTransport(() => productHtml())
  await assert.rejects(run(transport, false), /disabled/)
  assert.equal(transport.calls(), 0)
})
