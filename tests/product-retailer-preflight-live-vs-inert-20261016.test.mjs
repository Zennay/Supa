import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { PoliteFetcher } from '../scraper/lib/http.mjs'

// Regression contracts for the narrow compatibility with old in-process
// hostless budget fakes. Real HTTP never gets an originless exemption.
const ITEM = 'https://fictional.example.test/item'
const HOST = 'fictional.example.test'
function fixture({ host, fetcher, renderer, mode = 'http', saveHtmlDir } = {}) {
  const recorded = []
  const adapter = {
    id: 'fictional', host, mode, concurrency: 1,
    async *discover() { yield { kind: 'product', url: ITEM } },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(fn) { fn() }, finishRun() {},
  }
  return runRetailer(adapter, {
    store, fetcher, renderer, saveHtmlDir, limit: 1,
  }).then((result) => ({ result, recorded }))
}
test('real PoliteFetcher refuses missing adapter host before any outbound transport', async () => {
  let calls = 0
  const fetcher = new PoliteFetcher({
    respectRobots: false, minDelayMs: 0,
    fetchImpl: async () => { calls += 1; throw new Error('must not fetch') },
  })
  const { result } = await fixture({ fetcher })
  assert.equal(calls, 0)
  assert.equal(result.pages, 0)
  assert.equal(result.products, 0)
  assert.equal(result.errors, 1)
})
test('browser fake cannot bypass origin authorization when adapter host is absent', async () => {
  let calls = 0
  const { result } = await fixture({
    mode: 'browser',
    renderer: { render: async () => { calls++; return { url: ITEM, text: '' } } },
    fetcher: { request: async () => { throw new Error('unexpected HTTP') } },
  })
  assert.equal(calls, 0)
  assert.equal(result.pages, 0)
  assert.equal(result.errors, 1)
})
test('configured adapter host controls in-process injected HTTP mock as well', async () => {
  let calls = 0
  const { result } = await fixture({
    host: 'other.example.test',
    fetcher: { request: async () => { calls++; return { url: ITEM, text: '' } } },
  })
  assert.equal(calls, 0)
  assert.equal(result.pages, 0)
  assert.equal(result.errors, 1)
})
test('exact configured HTTPS adapter source permits fake request without publishing prices', async () => {
  let calls = 0
  const { result } = await fixture({
    host: HOST,
    fetcher: { request: async (url) => { calls++; return { url, text: '' } } },
  })
  assert.equal(calls, 1)
  assert.equal(result.pages, 1)
  assert.equal(result.products, 0)
  assert.equal(result.errors, 0)
})
