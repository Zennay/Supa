import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Independent synthetic fixture MIGRATION CONTRACT for historical QA tests
// which originally omitted adapter.host. The tests' intention (exact request
// budget, no fabricated prices) stays intact, while an explicit authorized
// fictional source is always required before any HTTP/browser request.
// No DNS/sockets/browser, genuine permissions, retailer data or prices.
const HOST = 'qa-source.example.test'
const base = `https://${HOST}/fictional/article-`

async function run({ count = 8, concurrency = 4, limit = 3, host = HOST } = {}) {
  const requested = []
  const store = {
    upsertRetailer() {},
    startRun() { return 1 },
    transaction(fn) { fn() },
    finishRun() {},
    saveRecord() { throw new Error('synthetic empty catalog may not produce prices') },
  }
  const adapter = {
    id: 'synthetic',
    host,
    mode: 'http',
    concurrency,
    async *discover() {
      for (let i = 0; i < count; i += 1) {
        await Promise.resolve()
        yield { kind: 'product', url: base + i }
      }
    },
    parse() { return [] },
  }
  const fetcher = {
    async request(url) {
      requested.push(url)
      return { url, text: '<html>fictional inert source</html>' }
    },
  }
  const summary = await runRetailer(adapter, { store, fetcher, limit })
  return { summary, requested }
}

test('explicitly scoped fictional source keeps one-request hard limit with parallel workers', async () => {
  const { summary, requested } = await run({ count: 12, concurrency: 8, limit: 1 })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.pages, 1)
  assert.equal(summary.errors, 0)
  assert.deepEqual(requested, [base + 0])
})

test('explicitly scoped synthetic catalog preserves three-request budget and zero invented prices', async () => {
  const { summary, requested } = await run({ count: 12, concurrency: 6, limit: 3 })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.pages, 3)
  assert.equal(summary.errors, 0)
  assert.equal(summary.products, 0)
  assert.deepEqual(requested, [base + 0, base + 1, base + 2])
})

test('operator zero-request budget does not invoke any fake source', async () => {
  const { summary, requested } = await run({ count: 12, concurrency: 8, limit: 0 })
  assert.equal(summary.pages, 0)
  assert.deepEqual(requested, [])
  assert.equal(summary.products, 0)
})

test('missing retailer host must not be treated as a valid authority even with empty parser', async () => {
  const { summary, requested } = await run({ count: 1, concurrency: 1, limit: 1, host: undefined })
  assert.deepEqual(requested, [])
  assert.equal(summary.pages, 0)
  assert.equal(summary.products, 0)
  assert.equal(summary.errors, 1, 'invalid origin should not be counted as a successful page')
})
