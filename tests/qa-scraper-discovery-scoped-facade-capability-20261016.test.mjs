import test from 'node:test'
import assert from 'node:assert/strict'
import { PoliteFetcher } from '../scraper/lib/http.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// A scoped facade must not inherit capabilities that perform unscoped I/O.
// All transport below is a fake fetchImpl spy; no DNS, sockets, browser,
// retailer requests, real permission, price or evidence is involved.
const HOST = 'shop.example.test'
const CATALOG = `https://${HOST}/catalog/fictional`
const ARTICLE = `https://${HOST}/item/fictional`
const FOREIGN = 'https://foreign.example.test/catalog/offscope'

async function inspect(discoveryMethod) {
  const requests = []
  const body = Buffer.from('<html>synthetic no-price page</html>')
  const fetcher = new PoliteFetcher({
    respectRobots: false, minDelayMs: 0, retries: 0,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      requests.push(url)
      return {
        url, status: 200, ok: true,
        headers: { get() { return null } },
        body: { async cancel() {} },
        async arrayBuffer() { return body },
      }
    },
  })
  const adapter = {
    id: 'fictional', host: HOST, mode: 'http', concurrency: 1,
    async *discover({ fetcher: facade }) {
      if (discoveryMethod === 'once') {
        // This low-level method must not remain exposed on a "scoped" facade.
        await facade.once(FOREIGN, { method: 'GET', headers: {} })
      } else if (discoveryMethod === 'rawFetch') {
        // Same risk through the inherited transport callback property.
        await facade.fetchImpl(FOREIGN, { redirect: 'manual' })
      } else {
        assert.match(await facade.getText(CATALOG), /synthetic no-price/)
      }
      yield { kind: 'product', url: ARTICLE }
    },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(fn) { fn() }, finishRun() {},
    saveRecord() { throw new Error('QA cannot persist an unobserved product') },
  }
  const result = await runRetailer(adapter, { store, fetcher, limit: 1 })
  return { requests, result }
}

test('approved catalog getText and article work through the restricted discovery API', async () => {
  const { requests, result } = await inspect('getText')
  assert.deepEqual(requests, [CATALOG, ARTICLE])
  assert.equal(result.status, 'ok')
  assert.equal(result.pages, 1)
  assert.equal(result.products, 0)
})

test('discovery cannot invoke inherited unscoped PoliteFetcher.once [EXPECTED RED]', async () => {
  const { requests, result } = await inspect('once')
  assert.deepEqual(requests, [], 'off-retailer once must never reach fake transport')
  assert.equal(result.pages, 0)
  assert.equal(result.products, 0)
})

test('discovery cannot directly invoke inherited raw fetchImpl [EXPECTED RED]', async () => {
  const { requests, result } = await inspect('rawFetch')
  assert.deepEqual(requests, [], 'scoped facade must not expose raw transport')
  assert.equal(result.pages, 0)
  assert.equal(result.products, 0)
})
