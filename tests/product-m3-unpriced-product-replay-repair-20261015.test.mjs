import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runApprovedRetailerComparison } from '../scripts/retailer-approved-pipeline.mjs'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// Product-owned safety controls; all prices, pages, transport and permissions
// are fictional. No real retailers are accessed or authorized by these tests.
const nowMs = Date.parse('2026-10-15T11:00:00Z')
const capturedAt = '2026-10-15T10:00:00Z'
const sources = ['plus-product-halfvolle-melk', 'dekamarkt-product-halfvolle-melk']
const requirements = [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }]
const page = (offer) => '<script type="application/ld+json">' + JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Product',
  sku: 'fictional-halfvolle-melk', name: 'Halfvolle melk',
  weight: { value: '1000 ml' }, offers: offer,
}) + '</script>'
const noPrice = page({ '@type': 'Offer', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock' })
const indicativeOnly = page({ '@type': 'AggregateOffer', lowPrice: '0.59',
  highPrice: '1.99', priceCurrency: 'EUR' })
const validPrice = page({ '@type': 'Offer', price: '1.29', priceCurrency: 'EUR',
  availability: 'https://schema.org/InStock' })
const fictionalRights = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-15',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{ kind: 'written_permission',
      url: 'https://example.org/test-only',
      finding: 'Synthetic test transport, not a retailer license' }],
  })),
}
function simulatedTransport(html) {
  let calls = 0
  return {
    get calls() { return calls },
    fetchImpl: async (url, init) => {
      calls++
      assert.equal(init.credentials, 'omit')
      assert.equal(init.redirect, 'error')
      const bytes = new TextEncoder().encode(html)
      return {
        url, status: 200, ok: true,
        headers: { get(name) {
          return name === 'content-type' ? 'text/html' : null
        } },
        body: new ReadableStream({ start(controller) {
          controller.enqueue(bytes)
          controller.close()
        } }),
      }
    },
  }
}
async function offlinePair(t, html) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-product-unpriced-replay-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'plus.html'), html)
  await writeFile(join(folder, 'deka.html'), html)
  const manifestPath = join(folder, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    version: 1, requirements,
    snapshots: sources.map((sourceId, index) => ({
      sourceId, capturedAt, htmlFile: index ? 'deka.html' : 'plus.html',
    })),
  }))
  return manifestPath
}
function noMoney(comparison) {
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.comparable, false)
  assert.equal(comparison.cheaperStore, null)
  assert.equal(comparison.savingsCents, null)
}
for (const [label, html] of [
  ['Offer missing checkout price', noPrice],
  ['AggregateOffer has only indicative range', indicativeOnly],
]) {
  test('approved capture preserves no-money preview for ' + label, async () => {
    const transport = simulatedTransport(html)
    const result = await runApprovedRetailerComparison({
      requirements, enableLive: true, permissionDocument: fictionalRights,
      fetchImpl: transport.fetchImpl, nowMs,
    })
    assert.equal(transport.calls, 2)
    assert.deepEqual(result.captureSummary.map(item => item.extractedProducts), [1, 1])
    assert.equal(result.captureSummary[0].sha256, result.captureSummary[1].sha256)
    noMoney(result.comparison)
    assert.equal(result.claimable, false)
  })
  test('local compare preserves no-money preview for ' + label, async t => {
    const manifestPath = await offlinePair(t, html)
    const result = await compareLocalRetailerSnapshots(manifestPath, nowMs)
    assert.deepEqual(result.captureSummary.map(item => item.parsedProducts), [1, 1])
    noMoney(result.comparison)
  })
}
test('approved stream still rejects replay of exactly priced Product', async () => {
  const transport = simulatedTransport(validPrice)
  await assert.rejects(runApprovedRetailerComparison({
    requirements, enableLive: true, permissionDocument: fictionalRights,
    fetchImpl: transport.fetchImpl, nowMs,
  }), /Duplicate priced retailer capture across sources/)
  assert.equal(transport.calls, 2)
})
test('local snapshots still reject replay of exactly priced Product', async t => {
  const manifestPath = await offlinePair(t, validPrice)
  await assert.rejects(compareLocalRetailerSnapshots(manifestPath, nowMs),
    /Duplicate priced offline HTML capture reused across sources/)
})
test('live collection remains off by default', async () => {
  const transport = simulatedTransport(validPrice)
  await assert.rejects(runApprovedRetailerComparison({
    requirements, permissionDocument: fictionalRights,
    fetchImpl: transport.fetchImpl, nowMs,
  }), /disabled/)
  assert.equal(transport.calls, 0)
})
