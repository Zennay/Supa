import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Independent browser-mode provenance QA on frozen owner source #3573.
// Everything below is fictional and in-memory; renderer never starts a
// browser, fetcher never sends an HTTP request and no retailer prices exist.
const host = 'shop.example.test'
const requested = `https://${host}/products/demo`
async function run({ finalUrl = requested, articleUrl = requested } = {}) {
  const calls = []
  const saved = []
  const adapter = {
    id: 'fictional', host, mode: 'browser',
    async *discover() {
      yield { kind: 'product', url: requested }
    },
    parse(_html, url) {
      calls.push(['parse', url])
      return [makeRecord({
        retailer: 'fictional', sourceId: 'imaginary-sku',
        url: articleUrl, name: 'Imaginary porridge 500g',
        priceCents: 245, packText: '500 g', availability: 'available',
      })]
    },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 31 },
    transaction(fn) { fn() }, saveRecord(record) { saved.push(record) },
    finishRun() {},
  }
  const renderer = {
    async render(url) {
      calls.push(['render', url])
      return { url: finalUrl, text: '<html>fake browser-only content</html>' }
    },
  }
  const fetcher = {
    async request() { throw new Error('browser mode must not issue raw HTTP') },
  }
  const result = await runRetailer(adapter, {
    fetcher, renderer, store, limit: 1,
  })
  return { result, saved, calls }
}

test('approved browser final source + article URL admits one fictional record', async () => {
  const { result, saved, calls } = await run({})
  assert.equal(result.products, 1)
  assert.equal(result.errors, 0)
  assert.deepEqual(saved.map(x => x.sourceId), ['imaginary-sku'])
  assert.deepEqual(calls, [['render', requested], ['parse', requested]])
})

for (const [name, options] of [
  ['foreign browser final response', { finalUrl: 'https://outside.example.test/demo' }],
  ['HTTP downgraded browser final response', { finalUrl: `http://${host}/demo` }],
]) {
  test(name + ' cannot reach parser, price archive or product count', async () => {
    const { result, saved, calls } = await run(options)
    assert.equal(result.products, 0)
    assert.equal(saved.length, 0)
    assert.deepEqual(calls, [['render', requested]])
  })
}
for (const [name, articleUrl] of [
  ['foreign source article', 'https://outside.example.test/demo'],
  ['source hostname suffix spoof', 'https://shop.example.test.attacker.invalid/demo'],
  ['missing article URL', null],
]) {
  test('valid browser response cannot launder ' + name, async () => {
    const { result, saved, calls } = await run({ articleUrl })
    assert.equal(result.products, 0)
    assert.equal(saved.length, 0)
    assert.deepEqual(calls, [['render', requested], ['parse', requested]])
  })
}
