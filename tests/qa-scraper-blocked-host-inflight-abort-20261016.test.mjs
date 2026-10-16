import test from 'node:test'
import assert from 'node:assert/strict'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { HostBlockedError } from '../scraper/lib/http.mjs'
import { makeRecord } from '../scraper/lib/normalize.mjs'

// Offline deterministic concurrency: both fake requests have started before
// one returns a host block. The other resolves one event-loop tick *after*
// the block. A blocked source must not allow a late in-flight response to
// persist or count a trustworthy retailer price after fail-closed abort.
// No network, browser, SQLite, real source URL or rights approval is used.
const HOST = 'retailer.example.test'

function makeFixture() {
  const saved = []
  const pages = ['first', 'second']
  const adapter = {
    id: 'fictional',
    name: 'Fictional blocked source',
    host: HOST,
    status: 'active',
    mode: 'http',
    concurrency: 2,
    async *discover() {
      for (const id of pages) yield { url: `https://${HOST}/${id}`, kind: 'product' }
    },
    parse(_html, url) {
      return [makeRecord({
        retailer: 'fictional',
        sourceId: url.endsWith('/second') ? 'late-record' : 'first-record',
        url,
        name: 'Fictional rice 500 g',
        priceCents: 225,
        packText: '500 g',
        availability: 'available',
      })]
    },
  }
  const store = {
    upsertRetailer() {},
    startRun() { return 101 },
    all() { return [] },
    transaction(fn) { fn() },
    saveRecord(r) { saved.push(r) },
    finishRun(_id, result) { this.finished = result },
  }
  return { saved, store, adapter }
}

test('same concurrent local fixture with two valid pages keeps both in normal allowed state', async () => {
  const { saved, store, adapter } = makeFixture()
  const fetcher = { async request(url) { return { url, text: '<div>fictional</div>' } } }
  const result = await runRetailer(adapter, { store, fetcher, limit: 2 })
  assert.equal(result.status, 'ok')
  assert.equal(result.products, 2)
  assert.equal(saved.length, 2)
})

test('host block wins over a late successful in-flight response: no post-block price writes', async () => {
  const { saved, store, adapter } = makeFixture()
  let bothStarted
  const ready = new Promise(resolve => { bothStarted = resolve })
  let started = 0
  const fetcher = {
    async request(url) {
      started += 1
      if (started === 2) bothStarted()
      await ready
      if (url.endsWith('/first')) throw new HostBlockedError(HOST, 'synthetic 403')
      // This successful reply is deliberately later than the rejection
      // microtask, so abort can become visible to the second worker.
      await new Promise(resolve => setImmediate(resolve))
      return { url, text: '<div>late fictional data</div>' }
    },
  }
  const result = await runRetailer(adapter, { store, fetcher, limit: 2 })
  assert.equal(started, 2, 'both in-flight paths must really run')
  assert.equal(result.status, 'blocked', 'blocked source must not report a successful run')
  assert.equal(store.finished.status, 'blocked')
  assert.equal(result.products, 0, 'late response after block must not count as accepted product')
  assert.deepEqual(saved, [], 'late response after block must never become a persisted priced record')
})
