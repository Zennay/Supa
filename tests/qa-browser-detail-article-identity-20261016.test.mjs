import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Independent quality-validation of the browser-rendered path (the original
// immutable same-article test uses HTTP). No real browser, retailer, network
// requests, source grants, personal data, price publication or production DB.
const host = 'shop.example.test'
const requested = `https://${host}/products/100`
const redirected = `https://${host}/products/100-renamed`
const row = (url, id = '100') => makeRecord({
  retailer: 'fictional-browser', sourceId: id, url,
  name: 'Invented cereal 500 g', packText: '500 g',
  priceCents: 245, availability: 'available',
})
async function simulate({
  kind = 'product', finalUrl = requested,
  sourceUrl = requested, records = [row(requested)],
} = {}) {
  const saved = []
  const observed = []
  const adapter = {
    id: 'fictional-browser', host, mode: 'browser',
    async *discover() { yield { kind, url: sourceUrl } },
    parse(_html, actualUrl) {
      observed.push(['parse', actualUrl])
      return records
    },
  }
  const renderer = {
    async render(url) {
      observed.push(['render', url])
      return { url: finalUrl, text: '<html>in-memory browser evidence</html>' }
    },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 13 },
    transaction(fn) { fn() },
    saveRecord(record) { saved.push(record) },
    finishRun() {},
  }
  const fetcher = {
    async request() { throw new Error('HTTP transport must never run in browser mode') },
  }
  const summary = await runRetailer(adapter, { renderer, fetcher, store, limit: 1 })
  return { saved, summary, observed }
}

test('browser product page permits its matching observed article', async () => {
  const { saved, summary } = await simulate()
  assert.equal(summary.status, 'ok')
  assert.equal(summary.products, 1)
  assert.deepEqual(saved.map(x => x.sourceId), ['100'])
})

test('browser same-host legitimate final product redirect remains authorized', async () => {
  const { saved, summary, observed } = await simulate({
    finalUrl: redirected, records: [row(redirected)],
  })
  assert.equal(summary.products, 1)
  assert.equal(saved.length, 1)
  assert.deepEqual(observed, [['render', requested], ['parse', redirected]])
})

test('browser final product redirect never authorizes a sibling SKU', async () => {
  const { saved, summary } = await simulate({
    finalUrl: redirected,
    records: [row(`https://${host}/products/999`, '999')],
  })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.products, 0)
  assert.deepEqual(saved, [])
})

test('browser product detail preserves query-param SKU identity', async () => {
  const requestedSku = `https://${host}/products/detail?id=100`
  const { saved, summary } = await simulate({
    sourceUrl: requestedSku, finalUrl: requestedSku,
    records: [row(`https://${host}/products/detail?id=200`, '200')],
  })
  assert.equal(summary.products, 0)
  assert.deepEqual(saved, [])
})

test('browser catalog remains able to produce two distinct trusted articles', async () => {
  const catalog = `https://${host}/catalog`
  const { saved, summary } = await simulate({
    kind: 'catalog', sourceUrl: catalog, finalUrl: catalog,
    records: [row(`https://${host}/products/100`, '100'),
      row(`https://${host}/products/200`, '200')],
  })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.products, 2)
  assert.deepEqual(saved.map(x => x.sourceId), ['100', '200'])
})
