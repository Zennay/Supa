import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
} from '../src/data/plusRenderedListings.ts'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

// Independent QA for *exact* archived URL identity. The standard WHATWG URL
// parser reports empty search/hash for literal trailing '?' and '#'; those
// noncanonical URL bytes must not acquire the reviewed snapshot's authority.
// Only previously checked-in, sanitized historical fixture copies are used.
// There is no retailer HTTP, live grant, real token, or present-price claim.
const cases = [
  ['PLUS', 'catalog', 'plus-rendered-catalog.v1.json', parsePlusRenderedCatalogEvidence],
  ['PLUS', 'offers', 'plus-rendered-offers.v1.json', parsePlusRenderedOffersEvidence],
  ['DekaMarkt', 'catalog', 'dekamarkt-catalog-melk.v1.json', parseDekaMarktSsrCatalogEvidence],
  ['DekaMarkt', 'offers', 'dekamarkt-offers.v1.json', parseDekaMarktSsrOffersEvidence],
]
const snapshot = async file => JSON.parse(await readFile(
  new URL('../fixtures/m1/' + file, import.meta.url), 'utf8',
))

for (const [retailer, kind, file, parse] of cases) {
  test(retailer + ' ' + kind + ' existing reviewed historical fixture still parses', async () => {
    const reviewed = await snapshot(file)
    const result = parse(reviewed)
    assert.equal(result.type, 'observations')
    assert.ok(result.observations.length > 0)
    for (const item of result.observations) {
      assert.equal(item.provenance.url, reviewed.source.url)
      assert.equal(item.provenance.sha256, reviewed.source.sha256)
    }
  })

  for (const suffix of ['?', '#', '?#']) {
    test(retailer + ' ' + kind + ' rejects unreviewed bare URL delimiters ' + JSON.stringify(suffix), async () => {
      const changed = await snapshot(file)
      changed.source.url += suffix
      // Demonstrate why ordinary url.search/hash checks alone are insufficient.
      const parsed = new URL(changed.source.url)
      assert.equal(parsed.search, '')
      assert.equal(parsed.hash, '')
      assert.equal(parsed.href, changed.source.url)
      const result = parse(changed)
      assert.equal(result.type, 'abstain',
        retailer + ' ' + kind + ': literal unreviewed suffix ' + JSON.stringify(suffix))
      assert.equal(Object.hasOwn(result, 'observations'), false)
    })
  }
}
