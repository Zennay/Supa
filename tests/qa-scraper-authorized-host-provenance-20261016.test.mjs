import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Synthetic offline downstream source-integrity contract. The parser must not
// launder a URL from another host (or an HTTP/non-URL value) into the archived
// identity of an otherwise approved retailer. A matching "retailer" string is
// necessary but does not prove the origin of the quoted checkout price.
//
// This fixture uses only example.test host strings and injected local mocks:
// zero external HTTP, browser, real shop credentials or source grants.
async function ingest(records) {
  const saved = []
  let summaryStatus
  const adapter = {
    id: 'fictional',
    host: 'shop.example.test',
    name: 'Fictional approved shop',
    status: 'active',
    mode: 'http',
    async *discover() {
      yield { kind: 'catalog', url: 'https://shop.example.test/synthetic-page' }
    },
    parse() { return records },
  }
  const store = {
    upsertRetailer() {},
    startRun() { return 1 },
    saveRecord(record) { saved.push(record) },
    transaction(callback) { return callback() },
    finishRun(_run, result) { summaryStatus = result.status },
  }
  const fetcher = {
    async request() {
      return { text: '<html>purely offline fixture</html>', url: 'https://shop.example.test/synthetic-page' }
    },
  }
  const result = await runRetailer(adapter, { fetcher, store, limit: 1 })
  assert.equal(summaryStatus, result.status)
  return { saved, result }
}

function candidate(sourceUrl, id = 'fictional-sku') {
  return makeRecord({
    retailer: 'fictional',
    sourceId: id,
    url: sourceUrl,
    name: 'Fictional cereal 500 g',
    priceCents: 299,
    packText: '500 g',
    availability: 'available',
  })
}

test('same-host HTTPS article URL remains a valid offline captured record', async () => {
  const { result, saved } = await ingest([candidate('https://shop.example.test/products/cereal')])
  assert.equal(result.status, 'ok')
  assert.equal(result.products, 1)
  assert.equal(saved.length, 1)
})

for (const [label, sourceUrl] of [
  ['foreign article host', 'https://foreign.example.test/products/cereal'],
  ['hostname prefix spoof', 'https://shop.example.test.attacker.invalid/products/cereal'],
  ['username host spoof', 'https://shop.example.test@foreign.example.test/products/cereal'],
  ['insecure HTTP source', 'http://shop.example.test/products/cereal'],
  ['missing canonical source link', null],
]) {
  test(`approved adapter cannot archive paid price from ${label}`, async () => {
    const { saved, result } = await ingest([
      candidate('https://shop.example.test/products/genuine', 'good-sku'),
      candidate(sourceUrl, 'bad-sku'),
    ])
    assert.equal(result.products, 1,
      'invalid source identity cannot become a counted price under an approved adapter')
    assert.deepEqual(saved.map(record => record.sourceId), ['good-sku'],
      'only same-host HTTPS source evidence can be stored')
  })
}
