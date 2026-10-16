import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Product-core owned boundary tests. Fictional HTTPS source and in-memory store;
// no live retailer request, permission grant or production data.
const host = 'shop.example.test'
const page = `https://${host}/product?id=100`
const product = (url, sourceId) => makeRecord({
  retailer: 'synthetic', sourceId, url, name: 'Synthetic pasta 500 g',
  priceCents: 149, packText: '500 g', availability: 'available',
})

async function run({ kind = 'product', sourceUrl = page, finalUrl = sourceUrl, records } = {}) {
  const saved = []
  const adapter = {
    id: 'synthetic', host, mode: 'http',
    async *discover() { yield { kind, url: sourceUrl } },
    parse() { return records },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(action) { action() },
    saveRecord(record) { saved.push(record) },
    finishRun() {},
  }
  const fetcher = { async request() { return { url: finalUrl, text: '<html>fictional</html>' } } }
  const summary = await runRetailer(adapter, { store, fetcher, limit: 1 })
  return { saved, summary }
}

test('catalog page may list distinct approved same-host articles', async () => {
  const sourceUrl = `https://${host}/catalog`
  const records = [product(`https://${host}/product?id=100`, '100'),
    product(`https://${host}/product?id=200`, '200')]
  const { saved, summary } = await run({ kind: 'catalog', sourceUrl, records })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.products, 2)
  assert.equal(saved.length, 2)
})

test('product detail does not attribute price to distinct SKU in query', async () => {
  const { saved, summary } = await run({
    records: [product(`https://${host}/product?id=999`, '999')],
  })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.products, 0)
  assert.deepEqual(saved, [])
})

test('article fragment alone does not change detail identity', async () => {
  const { saved, summary } = await run({
    records: [product(page + '#ingredients', '100')],
  })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.products, 1)
  assert.equal(saved.length, 1)
})
