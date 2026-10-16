import test from 'node:test'
import assert from 'node:assert/strict'

import { runRetailer } from '../scraper/lib/runner.mjs'

// Completely synthetic pre-I/O scope tests. All scraper transport is replaced
// with local spies; no DNS, browser, HTTP, retailer data, permission or prices.
const HOST = 'source.example.test'
const VALID = `https://${HOST}/products/fictional`

async function exercise(url, mode = 'http') {
  const fetched = []
  const rendered = []
  const saved = []
  const adapter = {
    id: 'fictional',
    host: HOST,
    mode,
    concurrency: 1,
    async *discover() { yield { kind: 'product', url } },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {},
    startRun() { return 1 },
    saveRecord(record) { saved.push(record) },
    transaction(action) { action() },
    finishRun() {},
  }
  const fetcher = {
    async request(requested) {
      fetched.push(requested)
      return { url: requested, text: '<html>fictional empty product</html>' }
    },
  }
  const renderer = {
    async render(requested) {
      rendered.push(requested)
      return { url: requested, text: '<html>fictional empty product</html>' }
    },
  }
  const result = await runRetailer(adapter, { store, fetcher, renderer, limit: 1 })
  return { result, fetched, rendered, saved }
}

for (const mode of ['http', 'browser']) {
  test(`${mode} approved original retailer HTTPS work item reaches only its fake scoped transport`, async () => {
    const { result, fetched, rendered, saved } = await exercise(VALID, mode)
    assert.equal(result.status, 'ok')
    assert.equal(result.pages, 1)
    assert.equal(result.products, 0)
    assert.deepEqual(saved, [])
    assert.deepEqual(mode === 'http' ? fetched : rendered, [VALID])
    assert.deepEqual(mode === 'http' ? rendered : fetched, [])
  })

  for (const [label, url] of [
    ['foreign publicly routable host', 'https://unapproved.example.test/products/fictional'],
    ['suffix-spoof host', 'https://source.example.test.attacker.invalid/products/fictional'],
    ['downgraded plain HTTP', 'http://source.example.test/products/fictional'],
    ['userinfo host confusion', 'https://source.example.test@unapproved.example.test/item'],
    ['nonstandard HTTPS port', 'https://source.example.test:444/products/fictional'],
    ['loopback transport address', 'https://127.0.0.1/products/fictional'],
  ]) {
    test(`${mode} never contacts ${label} from a queued adapter work item [EXPECTED RED]`, async () => {
      const { result, fetched, rendered, saved } = await exercise(url, mode)
      assert.deepEqual(fetched, [], 'no fetcher callback before approved-origin preflight')
      assert.deepEqual(rendered, [], 'no browser-renderer callback before approved-origin preflight')
      assert.deepEqual(saved, [])
      assert.equal(result.products, 0)
      assert.equal(result.pages, 0, 'a rejected URL is not an observed retailer page')
    })
  }
}
