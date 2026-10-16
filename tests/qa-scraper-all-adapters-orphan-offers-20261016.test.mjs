import test from 'node:test'
import assert from 'node:assert/strict'
import { adapters } from '../scraper/adapters/index.mjs'
import { isValidRecord } from '../scraper/lib/normalize.mjs'

// In-process synthetic admission cases across every available (including
// blocked) parser. An Offer without a trustworthy Product identity is not
// a retailer listing and may not mint a valid persisted price. Invalid JSON
// must not be treated as proof. No fetcher, browser or database is created.
const SAMPLES = [
  [
    'orphan Offer JSON-LD with a number but no Product',
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Offer","price":"1.99","priceCurrency":"EUR"}</script>',
  ],
  [
    'nameless Product with an Offer',
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","offers":{"@type":"Offer","price":"1.99","priceCurrency":"EUR"}}</script>',
  ],
  [
    'blank-name Product with an Offer',
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"  ","offers":{"@type":"Offer","price":"1.99","priceCurrency":"EUR"}}</script>',
  ],
  [
    'broken JSON-LD that resembles a Product Offer',
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name": "broken", "offers":{"price":"1.99"</script>',
  ],
]

for (const adapter of adapters) {
  for (const [scenario, html] of SAMPLES) {
    test(`${adapter.id}: ${scenario} cannot mint a validated payable-price row`, async () => {
      const rows = await adapter.parse(
        `<!doctype html><html><body>${html}</body></html>`,
        `https://${adapter.host}/fictional-without-a-valid-product`,
      )
      assert.ok(Array.isArray(rows), 'adapter.parse must emit an array')
      const accepted = rows.filter(isValidRecord)
      assert.deepEqual(accepted, [], 'no identified product means no admissible checkout price record')
    })
  }
}
