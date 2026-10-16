import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'

// All callbacks are local spies; testing that adapters cannot access raw
// once()/fetchImpl or change the getText receiver to bypass scoped request.
const ORIGIN = 'source.example.test'
const GOOD = `https://${ORIGIN}/catalog`
const BAD = 'https://foreign.example.test/catalog'

function harness(discover) {
  const calls = []
  const fetcher = {
    request: async (url) => {
      calls.push(url)
      return { url, text: '<html>fictional source</html>' }
    },
    // Simulate a transport escape hatch reachable on old inherited façade.
    once: async (url) => {
      calls.push(`BYPASS:${url}`)
      return { url, text: 'unscoped transport' }
    },
    fetchImpl: async (url) => {
      calls.push(`BYPASS:${url}`)
      return { url, text: 'unscoped transport' }
    },
  }
  const adapter = {
    id: 'fictional', host: ORIGIN, mode: 'http',
    async *discover({ fetcher: scoped }) { await discover(scoped); yield { kind:'product', url:GOOD } },
    parse() { return [] },
  }
  const store = { upsertRetailer() {}, startRun() { return 1 }, transaction(f) { f() },
    finishRun() {}, saveRecord() { throw new Error('no prices') } }
  return runRetailer(adapter, { store, fetcher, limit:1 }).then(result=>({result,calls}))
}

test('discovery receives only frozen request/getText methods, not raw transport', async () => {
  const { result, calls } = await harness(async scoped => {
    assert.deepEqual(Object.keys(scoped).sort(), ['getText','request'])
    assert.equal(Object.isFrozen(scoped), true)
    assert.equal(scoped.once, undefined)
    assert.equal(scoped.fetchImpl, undefined)
    assert.equal(await scoped.getText(GOOD), '<html>fictional source</html>')
  })
  assert.deepEqual(calls, [GOOD,GOOD])
  assert.equal(result.pages, 1)
  assert.equal(result.products, 0)
})

test('detached getText cannot call foreign origin through custom receiver', async () => {
  const { result, calls } = await harness(async scoped => {
    const raw = { request: async () => { throw new Error('wrong receiver') } }
    await assert.rejects(scoped.getText.call(raw, BAD), /outside approved HTTPS source origin/)
    await assert.rejects(Promise.resolve(scoped.getText(BAD)), /outside approved HTTPS source origin/)
  })
  assert.deepEqual(calls, [GOOD])
  assert.equal(result.pages, 1)
  assert.equal(result.products, 0)
})
