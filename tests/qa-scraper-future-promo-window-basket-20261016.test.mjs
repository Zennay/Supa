import assert from 'node:assert/strict'
import test from 'node:test'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { getAdapter } from '../scraper/adapters/index.mjs'
import { findFreshProducts } from '../scraper/retailer-search-api.mjs'

// Local SQLite and deliberately fictional approved IDs only. No network,
// source-rights grant, real live retailer observation or publication occurs.
const now = new Date('2026-10-16T12:00:00.000Z')
function withObservation(t, { from, until }) {
  const store = new ScrapeStore(':memory:')
  t.after(() => store.close())
  store.upsertRetailer(getAdapter('dirk'))
  store.saveRecord({
    retailer: 'dirk',
    sourceId: 'QA-ONLY-FICTION-205',
    name: 'QA fictional cacao 500g',
    brand: 'Not a real store item',
    url: 'https://www.dirk.nl/producten/qa-fictional-cacao-205',
    category: 'QA-only',
    packText: '500 g', packAmount: 500, packUnit: 'g',
    packCount: 1, imageUrl: null, gtin: null, extraGtins: [],
    priceCents: 249, promoPriceCents: 99,
    promoLabel: 'Fictional future promotion',
    promoValidFrom: from, promoValidUntil: until,
    availability: 'available',
  }, { at: now.toISOString() })
  return store
}
function result(store) {
  const found = findFreshProducts(store.db, ['dirk'], 'fictional cacao', now)
  assert.equal(found.length, 1)
  assert.equal(found[0].regularPriceCents, 249)
  assert.equal(found[0].availability, 'available')
  return found[0]
}

test('active within-window offer is represented only as a fresh local review preview', t => {
  const store = withObservation(t, {
    from: '2026-10-16T10:00:00.000Z',
    until: '2026-10-17T10:00:00.000Z',
  })
  const row = result(store)
  assert.equal(row.offer, true)
  assert.equal(row.priceCents, 99)
})

test('future-starting offer must NOT undercut the regular basket price before validity begins', t => {
  const store = withObservation(t, {
    from: '2026-10-17T00:00:00.000Z',
    until: '2026-10-18T00:00:00.000Z',
  })
  const row = result(store)
  assert.equal(row.offer, false)
  assert.equal(row.priceCents, 249)
})

test('promotion with reversed from/until chronology never offers a purchasable discount', t => {
  const store = withObservation(t, {
    from: '2026-10-18T00:00:00.000Z',
    until: '2026-10-17T00:00:00.000Z',
  })
  const row = result(store)
  assert.equal(row.offer, false)
  assert.equal(row.priceCents, 249)
})

test('expired offer does not become a current discount even if observation is fresh', t => {
  const store = withObservation(t, {
    from: '2026-10-14T00:00:00.000Z',
    until: '2026-10-15T23:59:59.000Z',
  })
  const row = result(store)
  assert.equal(row.offer, false)
  assert.equal(row.priceCents, 249)
})
