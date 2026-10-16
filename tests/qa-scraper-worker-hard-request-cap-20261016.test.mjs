import assert from 'node:assert/strict'
import test from 'node:test'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Independent quality-validation of the physical work budget. All URLs are
// fictional example.test labels; the fetcher is a local function, not HTTP.
// Limiting a permitted collector's request count is still necessary AFTER
// source-rights approval. Never treat a generous concurrency setting as an
// exemption from the operator's --limit cap.
async function exercise({ concurrency, limit, available = 12 }) {
  const fetched = []
  const written = []
  let storedSummary
  const adapter = {
    id: 'qa-synthetic-retailer',
    // This is a permitted in-process fictional source, not live retailer I/O.
    // Request-budget QA must not rely on an unauthorised missing-host bypass.
    host: 'example.test',
    concurrency,
    mode: 'http',
    async *discover() {
      for (let index = 0; index < available; index += 1) {
        // Force each parallel worker to wait in the serialized discovery
        // queue, exposing any check-before-await request-budget race.
        await Promise.resolve()
        yield { kind: 'product', url: 'https://example.test/fictional-' + index }
      }
    },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {},
    startRun() { return 42 },
    transaction(fn) { return fn() },
    finishRun(id, summary) { storedSummary = { id, ...summary } },
  }
  const fetcher = {
    async request(url) {
      fetched.push(url)
      return { url, text: '<html>fictional offline-only capture</html>' }
    },
  }
  const result = await runRetailer(adapter, {
    store, fetcher, limit, log(message) { written.push(message) },
  })
  assert.equal(result.status, 'ok', written.join('\n'))
  assert.equal(storedSummary.id, 42)
  assert.equal(storedSummary.pages, result.pages)
  assert.equal(result.pages, fetched.length)
  assert.equal(result.products, 0, 'fictional empty parsing must not become a product price')
  assert.equal(result.errors, 0)
  assert.equal(new Set(fetched).size, fetched.length)
  return { result, fetched, written }
}

test('single-worker private scrape keeps its bounded number of offline fetches', async () => {
  const { result, fetched } = await exercise({ concurrency: 1, limit: 2 })
  assert.equal(result.pages, 2)
  assert.equal(fetched.length, 2)
})

test('eight parallel workers must not exceed a single-request operator cap', async () => {
  const { result, fetched } = await exercise({ concurrency: 8, limit: 1 })
  assert.equal(result.pages, 1, 'parallel workers overran the source request limit')
  assert.equal(fetched.length, 1)
})

test('six parallel workers must honor a three-request source budget', async () => {
  const { result, fetched } = await exercise({ concurrency: 6, limit: 3 })
  assert.equal(result.pages, 3, 'concurrent outstanding discovery exceeded the request budget')
  assert.equal(fetched.length, 3)
})

test('zero-request budget disables all fictional source fetches', async () => {
  const { result, fetched } = await exercise({ concurrency: 8, limit: 0 })
  assert.equal(result.pages, 0)
  assert.deepEqual(fetched, [])
})
