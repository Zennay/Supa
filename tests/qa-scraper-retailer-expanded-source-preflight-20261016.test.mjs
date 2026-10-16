import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'

// No actual browser/network, no retailer source permission or real product price.
// The first work item is an approved fictional article; the second is yielded
// by adapter.expand only after the first HTML has been parsed.
const HOST = 'source.example.test'
const APPROVED = `https://${HOST}/item/fictional-1`
const SECOND = `https://${HOST}/item/fictional-2`

async function capture(secondUrl, mode = 'http') {
  const calls = []
  const adapter = {
    id: 'fictional', host: HOST, mode, concurrency: 1,
    async *discover() { yield { kind: 'product', url: APPROVED } },
    parse() { return [] },
    async *expand(_text, item) {
      if (item.url === APPROVED) yield { kind: 'product', url: secondUrl }
    },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 1 },
    transaction(fn) { fn() },
    saveRecord() { throw new Error('no prices expected') },
    finishRun() {},
  }
  const text = '<html>fictional approved article without a price</html>'
  const fetcher = { async request(url) { calls.push({ mode: 'http', url }); return { url, text } } }
  const renderer = { async render(url) { calls.push({ mode: 'browser', url }); return { url, text } } }
  const summary = await runRetailer(adapter, { store, fetcher, renderer, limit: 2 })
  return { calls, summary }
}

for (const mode of ['http', 'browser']) {
  test(`${mode} adapter expands a valid same-store fictional article without blocking legitimate pagination`, async () => {
    const { calls, summary } = await capture(SECOND, mode)
    assert.deepEqual(calls, [{ mode, url: APPROVED }, { mode, url: SECOND }])
    assert.equal(summary.pages, 2)
    assert.equal(summary.errors, 0)
    assert.equal(summary.products, 0)
  })

  for (const [label, other] of [
    ['foreign source host', 'https://foreign.example.test/item/fictional'],
    ['retailer suffix spoof', 'https://source.example.test.attacker.invalid/item/fictional'],
    ['HTTP downgrade', 'http://source.example.test/item/fictional'],
    ['credential authority spoof', 'https://source.example.test@foreign.example.test/item/fictional'],
    ['custom HTTPS port', 'https://source.example.test:444/item/fictional'],
  ]) {
    test(`${mode} expanded article cannot escape approved retailer before transport: ${label} [EXPECTED RED]`, async () => {
      const { calls, summary } = await capture(other, mode)
      assert.deepEqual(calls, [{ mode, url: APPROVED }],
        'expanded foreign source must not reach fake fetch/render callback')
      assert.equal(summary.pages, 1, 'only first authorized page may count as captured')
      assert.equal(summary.products, 0)
    })
  }
}
