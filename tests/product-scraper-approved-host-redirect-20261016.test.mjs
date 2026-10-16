import test from 'node:test'
import assert from 'node:assert/strict'

import { runRetailer } from '../scraper/lib/runner.mjs'
import { makeRecord } from '../scraper/lib/normalize.mjs'

// Product-only offline provenance controls: never visit a real retailer.
// The independent original source-host QA remains unchanged in its own file.
async function run({ requested = 'https://shop.example.test/item', returned = requested, url = requested } = {}) {
  const saved = []
  const adapter = {
    id: 'synthetic',
    name: 'Synthetic',
    host: 'shop.example.test',
    mode: 'http',
    status: 'active',
    async *discover() { yield { kind: 'product', url: requested } },
    parse() {
      return [makeRecord({
        retailer: 'synthetic', sourceId: 'fictional-1', name: 'Imaginary cereal',
        url, priceCents: 299, packText: '500 g',
      })]
    },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(f) { return f() }, saveRecord(r) { saved.push(r) },
    finishRun() {},
  }
  const fetcher = { async request() { return { url: returned, text: '<html>test only</html>' } } }
  const summary = await runRetailer(adapter, { store, fetcher, limit: 1 })
  return { saved, summary }
}

test('approved host HTTPS retains a valid synthetically priced record', async () => {
  const { saved, summary } = await run()
  assert.equal(summary.products, 1)
  assert.equal(saved[0].sourceId, 'fictional-1')
})

for (const [label, args] of [
  ['cross-origin redirect', { returned: 'https://foreign.example.test/item' }],
  ['changed protocol redirect', { returned: 'http://shop.example.test/item' }],
  ['cross-origin initial work URL', { requested: 'https://foreign.example.test/item' }],
  ['approved hostname suffix attacker', { url: 'https://shop.example.test.attacker.invalid/item' }],
  ['same-host embedded basic-auth user', { url: 'https://user:pass@shop.example.test/item' }],
  ['nonstandard article port', { url: 'https://shop.example.test:444/item' }],
  ['protocol-relative article URL', { url: '//shop.example.test/item' }],
  ['empty article URL', { url: '' }],
  ['IP literal article URL', { url: 'https://127.0.0.1/item' }],
]) {
  test('approved ingest refuses ' + label, async () => {
    const { saved, summary } = await run(args)
    assert.equal(summary.products, 0)
    assert.deepEqual(saved, [])
  })
}
