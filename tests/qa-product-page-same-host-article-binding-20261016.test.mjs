import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Source-identity QA beyond retailer HOST authorization: product detail pages
// are not evidence of prices for a different article on that SAME host.
// Entirely invented in-memory pages/records, no HTTP, browser or retailer data.
const host = 'shop.example.test'
const requested = `https://${host}/products/detail-100`
const redirected = `https://${host}/products/detail-100-new-name`
async function run({ finalUrl = requested, articleUrl = requested } = {}) {
  const saved = []
  const visited = []
  const adapter = {
    id: 'fictional', host, mode: 'http',
    async *discover() { yield { kind: 'product', url: requested } },
    parse(_html, url) {
      visited.push(['parse', url])
      return [makeRecord({
        retailer: 'fictional',
        sourceId: 'synthetic-product-100',
        url: articleUrl,
        name: 'Fictional porridge 500 g',
        priceCents: 245, packText: '500 g', availability: 'available',
      })]
    },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 11 },
    transaction(fn) { fn() },
    saveRecord(row) { saved.push(row) },
    finishRun() {},
  }
  const fetcher = {
    async request(url) {
      visited.push(['fetch', url])
      return { url: finalUrl, text: '<html>inert test product page</html>' }
    },
  }
  const summary = await runRetailer(adapter, { store, fetcher, limit: 1 })
  return { saved, visited, summary }
}

test('single product detail record bound to requested source remains reviewable', async () => {
  const { saved, summary } = await run()
  assert.equal(summary.status, 'ok')
  assert.equal(summary.products, 1)
  assert.equal(saved.length, 1)
})

test('same-origin redirected product URL is a valid article identity', async () => {
  const { saved, summary } = await run({ finalUrl: redirected, articleUrl: redirected })
  assert.equal(summary.products, 1)
  assert.equal(saved.length, 1)
})

for (const [name, articleUrl, finalUrl] of [
  ['unrelated sibling SKU on original page',
    `https://${host}/products/detail-999`, requested],
  ['unrelated sibling SKU after benign same-origin redirect',
    `https://${host}/products/detail-999`, redirected],
  ['source catalog route mislabeled as detail item',
    `https://${host}/catalog`, requested],
]) {
  test('detail page cannot archive price as '+name, async () => {
    const { saved, visited, summary } = await run({ articleUrl, finalUrl })
    assert.deepEqual(visited, [['fetch', requested], ['parse', finalUrl]])
    assert.equal(summary.products, 0,
      'one product detail page cannot authorize an unrelated same-host article')
    assert.deepEqual(saved, [],
      'no invented paid price may be stored under unobserved article identity')
  })
}
