import test from 'node:test'
import assert from 'node:assert/strict'

import { adapters } from '../scraper/adapters/index.mjs'

// A broad offline fail-closed acceptance boundary for the entire adapter
// registry, not just the original PLUS+Deka historical fixtures. No fetcher,
// renderer, SQLite or external network is supplied or invoked.
//
// Empty/inert pages have no product, price, barcode or availability evidence.
// Even when the document advertises an Organization via JSON-LD, it is not a
// Product / Offer and must never create a retailer product record.
const EMPTY_DOCUMENTS = [
  ['zero-byte response', ''],
  ['ordinary HTML without product data', '<!doctype html><html><head></head><body><h1>Fictional homepage</h1></body></html>'],
  [
    'nonproduct schema.org metadata',
    '<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Fictional shop"}</script></head><body></body></html>',
  ],
]

test('adapter registry contains twelve distinct explicit retailer identities (9 active, 3 blocked)', () => {
  assert.equal(adapters.length, 12)
  assert.equal(new Set(adapters.map((adapter) => adapter.id)).size, adapters.length)
  assert.equal(adapters.filter((adapter) => adapter.status === 'active').length, 9)
  assert.equal(adapters.filter((adapter) => adapter.status === 'blocked').length, 3)
  for (const adapter of adapters) {
    assert.match(adapter.id, /^[a-z][a-z0-9-]*$/)
    assert.equal(typeof adapter.host, 'string')
    assert.equal(typeof adapter.parse, 'function')
  }
})

for (const adapter of adapters) {
  for (const [label, html] of EMPTY_DOCUMENTS) {
    test(`${adapter.id} refuses ${label} as a real product`, async () => {
      const output = await adapter.parse(
        html,
        `https://${adapter.host}/_supa_qa_not_a_product`,
      )
      assert.ok(Array.isArray(output), 'adapter.parse must return an array of product facts')
      assert.deepEqual(output, [], 'a document without actual source product evidence produces no normalized products or price candidates')
    })
  }
}
