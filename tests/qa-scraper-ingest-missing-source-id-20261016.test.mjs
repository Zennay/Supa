import assert from 'node:assert/strict'
import test from 'node:test'
import { makeRecord, isValidRecord } from '../scraper/lib/normalize.mjs'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

// Isolated, fictional QA inputs only. Store is in-memory, fetcher is a local
// stub, and no licensed retailer data is requested or claimed. A missing
// source identity must NEVER be converted to the literal "undefined"/"null"
// and allowed to overwrite an unrelated product in the archive.
const fictional = (patch = {}) => makeRecord({
  retailer: 'qa-offline',
  name: 'Fictional pantry item 500 g',
  priceCents: 249,
  packText: '500 g',
  availability: 'available',
  ...patch,
})

test('missing source identity fails closed rather than becoming a shared synthetic SKU', () => {
  for (const id of [undefined, null]) {
    const record = fictional({ sourceId: id })
    assert.equal(isValidRecord(record), false,
      'missing retailer source identifier must not create an archive key')
  }
})

test('arbitrary object, array or boolean is not a legitimate source identifier', () => {
  for (const id of [{ sku: 'fictional' }, [], true]) {
    assert.equal(isValidRecord(fictional({ sourceId: id })), false,
      'untrusted source identifier must be a bounded primitive ID')
  }
})

test('invalid negative, nonfinite and unsafe monetary observations abstain', () => {
  for (const priceCents of [-1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 10]) {
    assert.equal(isValidRecord(fictional({ sourceId: 'fictional-valid-id', priceCents })),
      false, 'invalid price cannot become an archived SKU observation')
  }
  assert.equal(isValidRecord(fictional({ sourceId: 'fictional-valid-id', priceCents: null })),
    true, 'missing price is unknown, not a reason to fabricate one')
})

test('direct fake-adapter ingest never persists missing-identity or negative-price rows', async () => {
  const store = new ScrapeStore(':memory:')
  try {
    const adapter = {
      id: 'qa-offline',
      name: 'Synthetic test adapter',
      host: 'example.test',
      status: 'active',
      mode: 'http',
      async *discover() {
        yield { kind: 'product', url: 'https://example.test/fictional-pantry' }
      },
      parse() {
        return [
          fictional({ sourceId: undefined, name: 'Fictional item A' }),
          fictional({ sourceId: null, name: 'Fictional item B' }),
          fictional({ sourceId: 'fictional-sku-C', name: 'Fictional item C', priceCents: -15 }),
        ]
      },
    }
    const summary = await runRetailer(adapter, {
      store,
      limit: 1,
      fetcher: { async request(url) { return { url, text: '<html>qa-only</html>' } } },
    })
    assert.equal(summary.pages, 1)
    assert.equal(summary.status, 'ok', 'invalid evidence must be discarded, not crash ingestion')
    assert.equal(summary.products, 0, 'unidentified/invalid records must not count as ingested')
    assert.equal(store.get('SELECT count(*) AS n FROM products').n, 0)
    assert.equal(store.get('SELECT count(*) AS n FROM prices').n, 0)
  } finally {
    store.close()
  }
})

test('well-formed fictional source identity and cent values remain valid', () => {
  assert.equal(isValidRecord(fictional({ sourceId: 'safe-product-42', priceCents: 249 })), true)
})
