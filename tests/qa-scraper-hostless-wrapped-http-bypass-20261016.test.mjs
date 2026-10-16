import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { PoliteFetcher } from '../scraper/lib/http.mjs'

// This is a targeted offline trust-boundary test on the product-hostless-fake
// compatibility exception. No DNS/socket/real retailer/source permissions.
// The "real" polite client also uses injected transport only.
const URL = 'https://other.example.test/fictional/article'

async function exercise({ host, wrapping = true, direct = false }) {
  const calls = []
  const polite = new PoliteFetcher({
    respectRobots: false, minDelayMs: 0, retries: 0,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, redirect: options.redirect })
      const bytes = Uint8Array.from([79, 75])
      return {
        url, status: 200, ok: true,
        headers: { get: () => null },
        body: { async cancel() {} },
        async arrayBuffer() { return bytes.buffer },
      }
    },
  })
  const fetcher = direct ? polite : wrapping
    ? { async request(url) { return polite.request(url) } }
    : { async request(url) { calls.push({ url, redirect: 'fake-only' }); return { url, text: 'fictional' } } }
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

test('missing retailer host cannot bypass source gate by wrapping a PoliteFetcher [EXPECTED RED]', async () => {
  const { calls, result } = await exercise({ host: undefined })
  assert.deepEqual(calls, [], 'adapter without approved host must never reach wrapped HTTP transport')
  assert.equal(result.pages, 0)
  assert.equal(result.products, 0)
})

test('explicit foreign source host cannot bypass gate with a wrapped PoliteFetcher', async () => {
  const { calls, result } = await exercise({ host: 'approved.example.test' })
  assert.deepEqual(calls, [])
  assert.equal(result.pages, 0)
  assert.equal(result.products, 0)
})

test('direct PoliteFetcher without retailer host remains denied', async () => {
  const { calls, result } = await exercise({ host: undefined, direct: true })
  assert.deepEqual(calls, [])
  assert.equal(result.pages, 0)
  assert.equal(result.products, 0)
})

test('legacy no-host pure in-memory test stub is currently allowed but must never persist prices', async () => {
  const { calls, result } = await exercise({ host: undefined, wrapping: false })
  assert.deepEqual(calls, [{ url: URL, redirect: 'fake-only' }])
  assert.equal(result.pages, 1)
  assert.equal(result.products, 0)
})
