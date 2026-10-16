import test from 'node:test'
import assert from 'node:assert/strict'

import { runRetailer } from '../scraper/lib/runner.mjs'

// The adapter gets fetcher directly from runRetailer({ ... }). A permission
// boundary must apply to discovery requests too, not only yielded products.
// All fetches here are in-memory spies. No browser, DNS, sockets, retailer,
// credential, actual price, real permission or external traffic is involved.
const HOST = 'shop.example.test'
const ALLOWED = `https://${HOST}/categories/fictional`

async function observe(discoveryUrl) {
  const calls = []
  const adapter = {
    id: 'fictional',
    host: HOST,
    mode: 'http',
    concurrency: 1,
    async *discover({ fetcher }) {
      // The adapter itself performs a catalog fetch before it yields
      // individual products. Queued-item guards alone cannot cover it.
      await fetcher.request(discoveryUrl)
      yield { kind: 'product', url: `https://${HOST}/article/fictional` }
    },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(action) { action() }, finishRun() {},
    saveRecord() { throw new Error('synthetic test cannot store prices') },
  }
  const fetcher = {
    async request(url) {
      calls.push(url)
      return { url, text: '<html>synthetic no-price source</html>' }
    },
  }
  const result = await runRetailer(adapter, { store, fetcher, limit: 1 })
  return { calls, result }
}

test('authorized same-retailer catalog discovery remains functional', async () => {
  const { calls, result } = await observe(ALLOWED)
  assert.deepEqual(calls, [ALLOWED, `https://${HOST}/article/fictional`])
  assert.equal(result.pages, 1)
  assert.equal(result.products, 0)
  assert.equal(result.errors, 0)
})

for (const [label, source] of [
  ['foreign HTTPS host', 'https://another.example.test/catalog'],
  ['suffix spoof', 'https://shop.example.test.attacker.invalid/catalog'],
  ['HTTP downgrade', 'http://shop.example.test/catalog'],
  ['userinfo authority spoof', 'https://shop.example.test@another.example.test/catalog'],
  ['nonstandard port', 'https://shop.example.test:444/catalog'],
]) {
  test(`adapter discovery may not invoke HTTP on ${label} [EXPECTED RED]`, async () => {
    const { calls, result } = await observe(source)
    assert.deepEqual(calls, [],
      'the provided discovery fetcher must enforce approved retailer origin before I/O')
    assert.equal(result.pages, 0,
      'an unauthorized catalog must not produce follow-up scraped product pages')
    assert.equal(result.products, 0)
  })
}
