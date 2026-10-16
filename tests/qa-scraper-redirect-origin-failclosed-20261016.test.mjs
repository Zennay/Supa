import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Independent offline QA: checking *only* the final product row URL is not
// sufficient when an HTTP client follows a redirect to a foreign origin.
// A third-party response must not enter the approved adapter's SQLite source
// namespace even if the parser yields an apparently legitimate product URL.
//
// All addresses use reserved .test hosts; the fetcher is an injected mock,
// not a network request. No actual source or permission assertion is made.
const host = 'shop.example.test'
const discovered = `https://${host}/products/demo`
const record = makeRecord({
  retailer: 'fictional',
  sourceId: 'locally-invented-product',
  url: discovered,
  name: 'Imaginary oatmeal',
  packText: '500 g',
  priceCents: 275,
  availability: 'available',
})

async function ingest(finalResponseUrl) {
  const saved = []
  let finished
  const adapter = {
    id: 'fictional',
    name: 'Fictional consented shop',
    host,
    mode: 'http',
    status: 'active',
    async *discover() { yield { kind: 'product', url: discovered } },
    parse() { return [record] },
  }
  const store = {
    upsertRetailer() {},
    startRun() { return 15 },
    transaction(fn) { fn() },
    saveRecord(value) { saved.push(value) },
    finishRun(_id, result) { finished = result },
  }
  const fetcher = {
    async request() { return { url: finalResponseUrl, text: '<p>synthetic response</p>' } },
  }
  const result = await runRetailer(adapter, { store, fetcher, limit: 1 })
  assert.equal(finished.status, result.status)
  return { saved, result }
}

test('approved same-origin response remains admissible for offline valid records', async () => {
  const { saved, result } = await ingest(discovered)
  assert.equal(result.products, 1)
  assert.deepEqual(saved.map(x => x.sourceId), ['locally-invented-product'])
})

test('benign same-host HTTPS product-path redirect remains admissible', async () => {
  const { saved, result } = await ingest(`https://${host}/products/renamed`)
  assert.equal(result.products, 1)
  assert.equal(saved.length, 1)
})

for (const [name, responseUrl] of [
  ['foreign HTTPS host', 'https://outside.example.test/products/demo'],
  ['host suffix spoof', 'https://shop.example.test.bad.invalid/products/demo'],
  ['insecure HTTP downgrade', `http://${host}/products/demo`],
  ['username authority spoof', `https://${host}@outside.example.test/products/demo`],
]) {
  test(`approved retailer cannot ingest a ${name} final response`, async () => {
    const { saved, result } = await ingest(responseUrl)
    assert.equal(result.products, 0, 'foreign final response must not produce a trusted price')
    assert.deepEqual(saved, [], 'nothing should be saved even if parser returns a plausible article URL')
  })
}
