import test from 'node:test'
import assert from 'node:assert/strict'

import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Two independent offline boundary controls: do not weaken source evidence
// admission when preserving the old synthetic, zero-price request-budget QA.
async function run({ priced, saveHtmlDir = null } = {}) {
  const saved = []
  const adapter = {
    id: 'fictional', name: 'Fictional source without configured host',
    mode: 'http',
    async *discover() { yield { kind: 'product', url: 'https://fictional.example.test/item' } },
    parse() {
      return priced ? [makeRecord({
        retailer: 'fictional',
        sourceId: 'inert-item',
        name: 'Synthetic not-attributed price',
        url: 'https://fictional.example.test/item',
        priceCents: 123,
      })] : []
    },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 }, transaction(fn) { fn() },
    saveRecord(record) { saved.push(record) }, finishRun() {},
  }
  const fetcher = {
    async request(url) { return { url, text: '<html>inert fixture only</html>' } },
  }
  return { result: await runRetailer(adapter, { store, fetcher, limit: 1, saveHtmlDir }), saved }
}

test('inert no-host mock parser can count one page without creating retailer evidence', async () => {
  const { result, saved } = await run({ priced: false })
  assert.equal(result.status, 'ok')
  assert.equal(result.pages, 1)
  assert.equal(result.products, 0)
  assert.deepEqual(saved, [])
})

test('no-host mock cannot persist a price even when source URL looks plausible', async () => {
  const { result, saved } = await run({ priced: true })
  assert.equal(result.products, 0)
  assert.ok(result.errors >= 1)
  assert.deepEqual(saved, [])
})
