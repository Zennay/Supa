import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { PoliteFetcher } from '../scraper/lib/http.mjs'

// Independent offline QA on the frozen #3555 product head. Discovery receives
// an origin-scoped request/getText facade, but must NOT inherit the original
// client's raw transport or one-shot HTTP methods. Every URL is fictional;
// the injected fetchImpl never opens DNS, HTTP sockets or a real browser.
const HOST = 'approved.example.test'
const CATALOG = `https://${HOST}/catalog/fictional`
const ARTICLE = `https://${HOST}/item/fictional`
const FOREIGN = 'https://outside.example.test/never-fetch'

async function probe(method, mode = 'http') {
  const calls = []
  const rawFetcher = new PoliteFetcher({
    respectRobots: false,
    retries: 0,
    minDelayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      calls.push({ via: 'raw', url })
      return {
        url, status: 200, ok: true,
        headers: { get: () => 'text/html' },
        body: null,
        async arrayBuffer() {
          return Buffer.from('<html>fictional inert page</html>').buffer.slice(
            Buffer.from('<html>fictional inert page</html>').byteOffset,
            Buffer.from('<html>fictional inert page</html>').byteOffset +
              Buffer.from('<html>fictional inert page</html>').byteLength,
          )
        },
      }
    },
  })
  const adapter = {
    id: 'fictional', host: HOST, mode,
    async *discover({ fetcher }) {
      if (method === 'raw-fetchImpl') await fetcher.fetchImpl(FOREIGN)
      else if (method === 'raw-once') await fetcher.once(FOREIGN, {})
      else if (method === 'request') await fetcher.request(CATALOG)
      else if (method === 'getText') await fetcher.getText(CATALOG)
      yield { kind: 'product', url: ARTICLE }
    },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(fn) { fn() }, finishRun() {},
    saveRecord() { throw new Error('no priced records permitted in QA') },
  }
  const renderer = {
    async render(url) {
      calls.push({ via: 'renderer', url })
      return { url, text: '<html>fictional inert page</html>' }
    },
  }
  const result = await runRetailer(adapter, {
    store, fetcher: rawFetcher, renderer, limit: 1,
  })
  return { calls, result }
}

for (const [method, mode] of [
  ['raw-fetchImpl', 'http'],
  ['raw-once', 'http'],
  ['raw-fetchImpl', 'browser'],
]) {
  test(`discovery must not inherit ${method} in ${mode} mode or send foreign I/O`, async () => {
    const { calls, result } = await probe(method, mode)
    assert.deepEqual(calls, [], 'unapproved transport must not be called even in synthetic transport')
    assert.equal(result.pages, 0)
    assert.equal(result.products, 0)
    assert.equal(result.status, 'failed')
  })
}
for (const [method, mode] of [
  ['request', 'http'],
  ['getText', 'http'],
  ['request', 'browser'],
  ['getText', 'browser'],
]) {
  test(`discovery preserves approved ${method} facade in ${mode} mode`, async () => {
    const { calls, result } = await probe(method, mode)
    assert.deepEqual(calls, [
      { via: 'raw', url: CATALOG },
      { via: mode === 'http' ? 'raw' : 'renderer', url: ARTICLE },
    ])
    assert.equal(result.status, 'ok')
    assert.equal(result.pages, 1)
    assert.equal(result.products, 0)
    assert.equal(result.errors, 0)
  })
}
