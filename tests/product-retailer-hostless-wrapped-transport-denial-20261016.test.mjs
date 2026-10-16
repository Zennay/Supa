import assert from 'node:assert/strict'
import test from 'node:test'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { PoliteFetcher } from '../scraper/lib/http.mjs'

// Host permission cannot be inferred from JS constructor identity: a plain
// object can wrap a real outbound-capable PoliteFetcher. Injected transport
// proves pre-I/O denial with no DNS, socket or retailer requests.
const URL = 'https://other.example.test/fictional/article'
async function exercise({ host, direct = false, fakeOnly = false }) {
  const calls = []
  const polite = new PoliteFetcher({
    respectRobots: false, minDelayMs: 0, retries: 0,
    sleepImpl: async () => {},
    fetchImpl: async (url, opts) => {
      calls.push({ url, redirect: opts.redirect })
      return { url, status: 200, ok: true,
        headers: { get: () => null },
        body: { async cancel() {} },
        async arrayBuffer() { return Uint8Array.of(111, 107).buffer },
      }
    },
  })
  const fetcher = fakeOnly
    ? { async request(url) { calls.push({ url, redirect: 'fake-only' }); return { url, text: 'fictional' } } }
    : direct ? polite : { async request(url) { return polite.request(url) } }
  const adapter = {
    id: 'fictional', host, mode: 'http',
    async *discover() { yield { kind: 'product', url: URL } },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(fn) { fn() }, finishRun() {},
    saveRecord() { throw new Error('no price data expected') },
  }
  const result = await runRetailer(adapter, { store, fetcher, limit: 1 })
  return { calls, result }
}
for (const [label, params] of [
  ['wrapped outbound-capable HTTP client', {}],
  ['direct HTTP client', { direct: true }],
  ['local in-memory fake HTTP client', { fakeOnly: true }],
]) {
  test(`missing retailer host rejects ${label} before any transport`, async () => {
    const { calls, result } = await exercise(params)
    assert.deepEqual(calls, [])
    assert.equal(result.pages, 0)
    assert.equal(result.products, 0)
    assert.equal(result.errors, 1)
  })
}
test('wrapped HTTP client cannot claim the wrong configured retailer host', async () => {
  const { calls, result } = await exercise({ host: 'approved.example.test' })
  assert.deepEqual(calls, [])
  assert.equal(result.pages, 0)
  assert.equal(result.products, 0)
})
