import assert from 'node:assert/strict'
import test from 'node:test'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { makeRecord } from '../scraper/lib/normalize.mjs'

// A single malformed fictional price row must be rejected individually: it
// must neither be published nor cause the valid same-page product to disappear
// when the transaction rolls back. This exercises actual in-memory SQLite,
// with a stub fetcher; NEVER reaches a real retailer or production archive.
const row = (id, priceCents) => makeRecord({
  retailer: 'qa-fixture',
  sourceId: id,
  // The synthetic valid record also carries its explicit approved source
  // article URL; source provenance is independent of the price validation.
  url: 'https://example.test/products/' + encodeURIComponent(String(id)),
  name: 'Synthetic offline ' + id,
  priceCents,
  availability: 'available',
  packText: '500 g',
})

async function ingested(records) {
  const store = new ScrapeStore(':memory:')
  try {
    const adapter = {
      id: 'qa-fixture', name: 'Offline QA', host: 'example.test',
      status: 'active', mode: 'http',
      async *discover() { yield { kind: 'catalog', url: 'https://example.test/inert' } },
      parse() { return records },
    }
    const summary = await runRetailer(adapter, {
      store,
      limit: 1,
      fetcher: {
        async request(url) { return { url, text: '<html>synthetic offline</html>' } },
      },
    })
    return {
      summary,
      products: store.all('SELECT source_id FROM products ORDER BY source_id').map(r => r.source_id),
      prices: store.all('SELECT price_cents FROM prices ORDER BY price_cents').map(r => r.price_cents),
    }
  } finally {
    store.close()
  }
}

test('two valid fictional product identities and cent amounts remain ingestible', async () => {
  const result = await ingested([row('fictional-A', 149), row('fictional-B', 249)])
  assert.equal(result.summary.status, 'ok')
  assert.equal(result.summary.products, 2)
  assert.deepEqual(result.products, ['fictional-A', 'fictional-B'])
  assert.deepEqual(result.prices, [149, 249])
})

test('one negative-price item cannot roll back its valid sibling in the same page', async () => {
  const result = await ingested([row('fictional-A', 149), row('fictional-invalid', -199)])
  assert.equal(result.summary.status, 'ok')
  assert.equal(result.summary.errors, 0, 'bad evidence must be isolated before SQL')
  assert.equal(result.summary.products, 1, 'a valid price on same page must survive')
  assert.deepEqual(result.products, ['fictional-A'])
  assert.deepEqual(result.prices, [149])
})

test('unsafe source-id and negative price together cannot change the valid sibling', async () => {
  const result = await ingested([
    row('fictional-A', 149),
    row(undefined, -199),
  ])
  assert.equal(result.summary.status, 'ok')
  assert.equal(result.summary.errors, 0)
  assert.equal(result.summary.products, 1)
  assert.deepEqual(result.products, ['fictional-A'])
  assert.deepEqual(result.prices, [149])
})
