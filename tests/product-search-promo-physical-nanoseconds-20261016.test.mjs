import assert from 'node:assert/strict'
import test from 'node:test'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { getAdapter } from '../scraper/adapters/index.mjs'
import { findFreshProducts } from '../scraper/retailer-search-api.mjs'

// Only local in-memory SQLite + made-up products and timestamps.
// This fixture is NOT a retailer license, HTTP observation or fresh public quote.
function preview(t, from, until, instant = '2026-10-16T12:00:00.000Z') {
  const db = new ScrapeStore(':memory:')
  t.after(() => db.close())
  db.upsertRetailer(getAdapter('dirk'))
  db.saveRecord({
    retailer: 'dirk', sourceId: 'PRIVATE-ONLY-PROMO-NANOS',
    name: 'Fictional cocoa 500g', brand: 'Not an actual product',
    url: 'https://www.dirk.nl/producten/private-fictional-cocoa',
    category: 'QA fictional', packText: '500 g', packAmount: 500,
    packUnit: 'g', packCount: 1, imageUrl: null,
    gtin: null, extraGtins: [],
    priceCents: 249, promoPriceCents: 99, promoLabel: 'Imaginary deal',
    promoValidFrom: from, promoValidUntil: until,
    availability: 'available',
  }, { at: instant })
  const results = findFreshProducts(db.db, ['dirk'], 'fictional cocoa',
    new Date(instant))
  assert.equal(results.length, 1, 'regular priced item must remain visible')
  assert.equal(results[0].regularPriceCents, 249)
  return results[0]
}

for (const [label, from, until, now, active] of [
  ['future by just 1 nanosecond in same millisecond',
    '2026-10-16T12:00:00.000000001Z',
    '2026-10-17T00:00:00.000Z',
    '2026-10-16T12:00:00.000Z', false],
  ['reversed by 1 nanosecond at same millisecond',
    '2026-10-16T11:59:59.999999999Z',
    '2026-10-16T11:59:59.999999998Z',
    '2026-10-16T12:00:00.000Z', false],
  ['expired by 1 nanosecond at same millisecond',
    '2026-10-15T00:00:00.000Z',
    '2026-10-16T11:59:59.999999999Z',
    '2026-10-16T12:00:00.000Z', false],
  ['timezone instant starts 1 nanosecond in the future',
    '2026-10-16T13:00:00.000000001+01:00',
    '2026-10-17T13:00:00.000+01:00',
    '2026-10-16T12:00:00.000Z', false],
  ['impossible February 30 must never silently become March 2',
    '2026-02-30T10:00:00.000Z',
    '2026-04-01T10:00:00.000Z',
    '2026-03-03T12:00:00.000Z', false],
  ['out-of-range UTC offset +14:01 is not an approved ISO clock',
    '2026-10-16T12:00:00.000+14:01',
    '2026-10-17T12:00:00.000Z',
    '2026-10-16T12:00:00.000Z', false],
  ['impossible leap date February 29 2025 never becomes March',
    '2025-02-29T10:00:00.000Z',
    '2026-11-01T00:00:00.000Z',
    '2026-10-16T12:00:00.000Z', false],
  ['positive exact zero fraction boundary',
    '2026-10-16T12:00:00.000000000Z',
    '2026-10-16T12:00:00.000000000Z',
    '2026-10-16T12:00:00.000Z', true],
  ['valid one nanosecond on each side of now is active',
    '2026-10-16T11:59:59.999999999Z',
    '2026-10-16T12:00:00.000000001Z',
    '2026-10-16T12:00:00.000Z', true],
  ['valid equal physical clock with different explicit offsets',
    '2026-10-16T13:00:00.000000000+01:00',
    '2026-10-16T12:00:00.000000000Z',
    '2026-10-16T12:00:00.000Z', true],
]) {
  test('product search refuses fictional invalid promo time: ' + label, t => {
    const actual = preview(t, from, until, now)
    assert.equal(actual.offer, active)
    assert.equal(actual.priceCents, active ? 99 : 249)
  })
}
