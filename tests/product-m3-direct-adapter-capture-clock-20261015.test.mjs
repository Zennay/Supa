import test from 'node:test'
import assert from 'node:assert/strict'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'

// Exercise the exported adapter directly. The CLI already preflights its own
// manifest; direct callers must not mint malformed capture-clock provenance.
const source = SOURCES.find(s => s.id === 'plus-product-halfvolle-melk')
const html = '<html><script type="application/ld+json">' + JSON.stringify({
  '@type': 'Product', name: 'Fictional halfvolle melk', sku: 'mock-milk-1',
  weight: { value: '1000 ml' }, offers: { '@type': 'Offer',
    price: '1.29', priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
  },
}) + '</script></html>'

for (const invalid of [
  '2026-10-15',
  '2026-10-15T10:00:00',
  'Thu, 15 Oct 2026 10:00:00 GMT',
  '2026-02-30T10:00:00Z',
  '2026-10-15T10:00:00+14:01',
  '2026-10-15T10:00:00-14:01',
  '2026-10-15T10:00:00+23:59',
  '2026-10-15T24:00:00Z',
  '2026-10-15T10:00:60Z',
  '2026-10-15T10:00:00.1234567890Z',
  '2026-10-15T10:00:00+02:60',
]) {
  test('direct M3 offline adapter rejects untrustworthy capture instant ' + invalid, () => {
    assert.throws(() => parseOfflineRetailerSnapshot({source,html,capturedAt:invalid}),
      /Invalid bounded offline snapshot/)
  })
}

for (const valid of [
  '2026-10-15T10:00:00Z',
  '2026-10-15T12:00:00+02:00',
  '2026-10-15T05:00:00-05:00',
  '2026-10-15T10:00:00.123456789Z',
  '2026-10-15T10:00:00+14:00',
  '2026-10-15T10:00:00-14:00',
]) {
  test('direct M3 offline adapter retains valid absolute capture instant ' + valid, () => {
    const result = parseOfflineRetailerSnapshot({source,html,capturedAt:valid})
    assert.equal(result.provenance.capturedAt,valid)
    assert.equal(result.scriptsInspected,1)
    assert.match(result.provenance.sha256,/^[0-9a-f]{64}$/)
    assert.equal(result.observations.length,1)
  })
}
