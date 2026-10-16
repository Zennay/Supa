import assert from 'node:assert/strict'
import test from 'node:test'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { makeRecord } from '../scraper/lib/normalize.mjs'

// Source ownership is immutable for the duration of one adapter job. A page
// collected under retailer A (even by an already approved source) cannot
// grant itself a second retailer's source identity through parser output.
// All records and HTTP responses below are fictional in-process fixtures.
const source = (retailer, sourceId) => makeRecord({
  retailer,
  sourceId,
  url: 'https://example.test/fictional/' + sourceId,
  name: 'Synthetic pantry item 500 g',
  packText: '500 g',
  priceCents: 249,
  availability: 'available',
})

async function offlineCapture(records) {
  const saved = []
  const trace = []
  let summaryRecord
  const adapter = {
    id: 'dirk',
    name: 'Fictional Dirk adapter',
    host: 'example.test',
    status: 'active',
    mode: 'http',
    async *discover() { yield { kind: 'catalog', url: 'https://example.test/fixture' } },
    parse() { return records },
  }
  const store = {
    upsertRetailer() {},
    startRun() { return 9 },
    transaction(fn) { return fn() },
    saveRecord(record) { saved.push(record) },
    finishRun(_id, record) { summaryRecord = record },
  }
  const fetcher = {
    async request(url) {
      trace.push(url)
      return { url, text: '<html>synthetic no-network page</html>' }
    },
  }
  const summary = await runRetailer(adapter, { store, fetcher, limit: 1 })
  assert.equal(summary.status, 'ok')
  assert.equal(summaryRecord.status, summary.status)
  assert.equal(summary.pages, 1)
  assert.deepEqual(trace, ['https://example.test/fixture'])
  return { saved, summary }
}

test('same-adapter fictional record is accepted by bounded local ingestion', async () => {
  const { saved, summary } = await offlineCapture([source('dirk', 'own-sku')])
  assert.equal(summary.products, 1)
  assert.deepEqual(saved.map(r => r.sourceId), ['own-sku'])
})

test('parser cannot silently write a PLUS record during an approved Dirk run', async () => {
  const { saved, summary } = await offlineCapture([
    source('dirk', 'own-sku'),
    source('plus', 'forged-foreign-source'),
  ])
  assert.equal(summary.products, 1,
    'cross-retailer parser output must not count as approved Dirk ingestion')
  assert.deepEqual(saved.map(r => r.retailer), ['dirk'],
    'source-origin must match the running approved adapter')
})

test('pure cross-retailer parser result does not create any priced archive rows', async () => {
  const { saved, summary } = await offlineCapture([source('plus', 'foreign-only')])
  assert.equal(summary.products, 0,
    'foreign retailer cannot piggyback on a source-scoped job')
  assert.deepEqual(saved, [])
})
