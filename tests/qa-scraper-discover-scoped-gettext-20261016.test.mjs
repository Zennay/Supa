import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Independent acceptance of the SECOND discovery fetcher interface, getText.
// The original user-supplied transport's getText may be unscoped; the runner
// must guard calls by routing through a retailer-scoped request method.
// All transport is in-memory and fictional: no HTTP, DNS, browser or prices.
const HOST = 'source.example.test'
const CAT = `https://${HOST}/categories/fictional`
const ARTICLE = `https://${HOST}/article/fictional`

async function observe(target, mode = 'http') {
  const called = []
  const adapter = {
    id: 'fictional', host: HOST, mode,
    async *discover({ fetcher }) {
      const html = await fetcher.getText(target)
      assert.match(html, /fictional catalog/)
      yield { kind: 'product', url: ARTICLE }
    },
    parse() { return [] },
  }
  const store = {
    upsertRetailer() {}, startRun() { return 17 },
    transaction(fn) { fn() }, finishRun() {},
    saveRecord() { throw new Error('price persistence not allowed in QA') },
  }
  const fetcher = {
    async request(url) {
      called.push(['request', url])
      return { url, text: '<html>fictional catalog without prices</html>' }
    },
    async getText(url) {
      called.push(['BYPASS original getText', url])
      return '<html>incorrect unscoped original method</html>'
    },
  }
  const renderer = {
    async render(url) {
      called.push(['renderer', url])
      return { url, text: '<html>fictional article without prices</html>' }
    },
  }
  const result = await runRetailer(adapter, { store, fetcher, renderer, limit: 1 })
  return { called, result }
}

for (const mode of ['http', 'browser']) {
  test(`scoped discover.getText admits one authorized catalog in ${mode} mode without using original raw getText`, async () => {
    const { called, result } = await observe(CAT, mode)
    assert.deepEqual(called, [['request', CAT], [mode === 'http' ? 'request' : 'renderer', ARTICLE]])
    assert.equal(result.status, 'ok')
    assert.equal(result.pages, 1)
    assert.equal(result.products, 0)
    assert.equal(result.errors, 0)
  })

  for (const [description, url] of [
    ['foreign host', 'https://foreign.example.test/catalog'],
    ['downgraded HTTP', 'http://source.example.test/catalog'],
    ['default-looking spoof suffix', 'https://source.example.test.evil.invalid/catalog'],
  ]) {
    test(`discover.getText never sends ${description} before any ${mode} transport`, async () => {
      const { called, result } = await observe(url, mode)
      assert.deepEqual(called, [], 'unapproved catalog URL must not reach even fake HTTP or browser I/O')
      assert.equal(result.pages, 0)
      assert.equal(result.products, 0)
      assert.equal(result.status, 'failed')
    })
  }
}
