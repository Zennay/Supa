import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { HostBlockedError } from '../scraper/lib/http.mjs'
import { dice, matchProducts, rebuildMatches } from '../scraper/lib/match.mjs'
import { makeRecord } from '../scraper/lib/normalize.mjs'
import { runRetailer } from '../scraper/lib/runner.mjs'

const retailers = ['dirk', 'spar', 'vomar', 'plus', 'hoogvliet'].map((id) => ({ id, name: id, host: `${id}.nl`, status: 'active' }))

function storeWith(records) {
  const store = new ScrapeStore(':memory:')
  for (const r of retailers) store.upsertRetailer(r)
  for (const r of records) store.saveRecord(makeRecord(r), { at: '2026-10-15T10:00:00.000Z' })
  return store
}

test('price history only grows when price facts change', () => {
  const store = storeWith([])
  const base = { retailer: 'dirk', sourceId: '1', name: 'Melk', packText: '1 liter', priceCents: 99, availability: 'available' }
  store.saveRecord(makeRecord(base), { at: '2026-10-14T10:00:00.000Z' })
  store.saveRecord(makeRecord(base), { at: '2026-10-15T10:00:00.000Z' })
  store.saveRecord(makeRecord({ ...base, promoPriceCents: 79, promoLabel: 'Actie' }), { at: '2026-10-16T10:00:00.000Z' })
  const rows = store.all('SELECT first_seen_at, last_seen_at, price_cents, promo_price_cents FROM prices ORDER BY id')
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { first_seen_at: '2026-10-14T10:00:00.000Z', last_seen_at: '2026-10-15T10:00:00.000Z', price_cents: 99, promo_price_cents: null },
    { first_seen_at: '2026-10-16T10:00:00.000Z', last_seen_at: '2026-10-16T10:00:00.000Z', price_cents: 99, promo_price_cents: 79 },
  ])
  const latest = store.get('SELECT effective_price_cents, pack_amount, pack_unit FROM latest_prices')
  assert.deepEqual({ ...latest }, { effective_price_cents: 79, pack_amount: 1000, pack_unit: 'ml' })
  store.close()
})

test('promo price that is not lower than the regular price is dropped', () => {
  const r = makeRecord({ retailer: 'x', sourceId: '1', name: 'A', priceCents: 100, promoPriceCents: 100 })
  assert.equal(r.promoPriceCents, null)
})

test('GTIN match joins the same article across retailers, incl. secondary EANs', () => {
  const store = storeWith([
    { retailer: 'spar', sourceId: 's1', name: 'Calvé Pindakaas', brand: 'Calvé', gtin: '8717163800300', packText: '350 g', priceCents: 449 },
    { retailer: 'vomar', sourceId: 'v1', name: 'Calve 100% Pindakaas', brand: 'Calve', gtin: '8711200430925', extraGtins: ['8717163800300'], packText: '350 gram', priceCents: 445 },
    { retailer: 'plus', sourceId: 'p1', name: 'Calvé Pindakaas', brand: 'Calvé', gtin: '08717163800300', packText: '350 g', priceCents: 459 },
  ])
  const summary = rebuildMatches(store)
  assert.equal(summary.multiRetailer, 1)
  assert.equal(summary.gtin, 3)
  const rows = store.all('SELECT retailer_id, effective_price_cents, method FROM price_comparison ORDER BY effective_price_cents')
  assert.deepEqual(rows.map((r) => [r.retailer_id, r.effective_price_cents, r.method]), [
    ['vomar', 445, 'gtin'],
    ['spar', 449, 'gtin'],
    ['plus', 459, 'gtin'],
  ])
  store.close()
})

test('retailer without GTIN (Dirk) attaches by brand + exact pack + similar name', () => {
  const store = storeWith([
    { retailer: 'spar', sourceId: 's1', name: 'Duyvis Oven Roasted Peanuts Salted', brand: 'Duyvis', gtin: '8710448620358', packText: '225 g', priceCents: 249 },
    { retailer: 'dirk', sourceId: 'd1', name: 'Duyvis Oven roasted peanuts salted', brand: 'Duyvis', packText: '225 g', priceCents: 229 },
    // Same brand and name but different pack size: must NOT match.
    { retailer: 'dirk', sourceId: 'd2', name: 'Duyvis Oven roasted peanuts salted', brand: 'Duyvis', packText: '450 g', priceCents: 399 },
    // Same pack, different product: must NOT match.
    { retailer: 'dirk', sourceId: 'd3', name: 'Duyvis Borrelnootjes paprika', brand: 'Duyvis', packText: '225 g', priceCents: 199 },
  ])
  rebuildMatches(store)
  const canon = (source) =>
    store.get('SELECT m.canonical_id AS c, m.method FROM product_matches m JOIN products p ON p.id = m.product_id WHERE p.source_id = ?', source)
  assert.equal(canon('d1').c, canon('s1').c)
  assert.equal(canon('d1').method, 'brand-name-pack')
  assert.notEqual(canon('d2').c, canon('s1').c)
  assert.notEqual(canon('d3').c, canon('s1').c)
  assert.equal(canon('d2').method, 'single')
  store.close()
})

test('fuzzy matching refuses ambiguous candidates and in-store GTINs', () => {
  const groups = matchProducts([
    { id: 1, retailer_id: 'spar', name: 'Hak Rode Kool met appel', brand: 'Hak', gtins: ['8720600609909'], pack_amount: 700, pack_unit: 'g', pack_count: 1 },
    { id: 2, retailer_id: 'plus', name: 'Hak Rode Kool appel', brand: 'Hak', gtins: ['8720600609916'], pack_amount: 700, pack_unit: 'g', pack_count: 1 },
    // Two different articles (different EANs) look identical to Dirk's name.
    { id: 3, retailer_id: 'dirk', name: 'Hak Rode kool appel', brand: 'Hak', gtins: [], pack_amount: 700, pack_unit: 'g', pack_count: 1 },
    // Variable-weight in-store codes are equal by accident, never a match.
    { id: 4, retailer_id: 'spar', name: 'Achterham', brand: 'Spar', gtins: ['2339636000000'], pack_amount: null, pack_unit: null, pack_count: 1 },
    { id: 5, retailer_id: 'hoogvliet', name: 'Casino wit', brand: 'Hoogvliet', gtins: ['2339636000000'], pack_amount: null, pack_unit: null, pack_count: 1 },
  ])
  const groupOf = (id) => groups.find((g) => g.members.some((m) => m.productId === id))
  assert.equal(groupOf(3).members.length, 1, 'two near-identical candidates => abstain')
  assert.notEqual(groupOf(4), groupOf(5))
  assert.ok(dice(['rode', 'kool'], ['rode', 'kool']) === 1)
})

test('runner stores products, follows expand() and reports a blocked host', async () => {
  const store = new ScrapeStore(':memory:')
  const pages = { 'https://shop.nl/list': '<p>1,2</p>', 'https://shop.nl/list?page=2': '<p>3</p>' }
  const fetcher = { request: async (url) => ({ url, text: pages[url] }) }
  const adapter = {
    id: 'shop', name: 'Shop', host: 'shop.nl', status: 'active', mode: 'http',
    async *discover() { yield { url: 'https://shop.nl/list', kind: 'listing' } },
    async *expand(html, item) { if (!item.page) yield { url: 'https://shop.nl/list?page=2', kind: 'listing', page: 2 } },
    parse: (html) => /<p>(.*)<\/p>/.exec(html)[1].split(',').map((id) => makeRecord({ retailer: 'shop', sourceId: id, url: `https://shop.nl/product/${id}`, name: `P${id}`, priceCents: 100 })),
  }
  const ok = await runRetailer(adapter, { store, fetcher })
  assert.deepEqual([ok.status, ok.pages, ok.products], ['ok', 2, 3])

  const blockedFetcher = { request: async () => { throw new HostBlockedError('shop.nl', 'HTTP 403') } }
  const blocked = await runRetailer(adapter, { store, fetcher: blockedFetcher })
  assert.equal(blocked.status, 'blocked')
  const runs = store.all('SELECT status FROM scrape_runs ORDER BY id').map((r) => r.status)
  assert.deepEqual(runs, ['ok', 'blocked'])
  store.close()
})

test('runner fails closed when pages stop yielding products (layout drift)', async () => {
  const store = new ScrapeStore(':memory:')
  const adapter = {
    id: 'drift', name: 'Drift', host: 'drift.nl', status: 'active', mode: 'http',
    async *discover() { for (let i = 0; i < 100; i += 1) yield { url: `https://drift.nl/p/${i}`, kind: 'product' } },
    parse: () => [],
  }
  const summary = await runRetailer(adapter, { store, fetcher: { request: async (url) => ({ url, text: '' }) } })
  assert.equal(summary.status, 'failed')
  assert.match(summary.message, /layout drift/)
  assert.equal(summary.pages, 40)
  store.close()
})

test('fuzzy matching rejects thin or contradicting name evidence', () => {
  const p = (id, retailer_id, name, extra = {}) => ({ id, retailer_id, name, brand: 'Huisman', gtins: [], pack_amount: 335, pack_unit: 'g', pack_count: 1, ...extra })
  const groups = matchProducts([
    p(1, 'vomar', 'Huisman Zaanse Mosterd', { gtins: ['8710605031024'] }),
    p(2, 'dirk', 'Huisman Mosterd grof'), // one shared word only
    p(3, 'vomar', 'Huggies DryNites girl 8-13 jaar', { brand: 'Huggies', gtins: ['5029053527581'], pack_amount: 1, pack_unit: 'piece', pack_count: 9 }),
    p(4, 'dirk', 'Huggies DryNites girl 8-15 jaar', { brand: 'Huggies', pack_amount: 1, pack_unit: 'piece', pack_count: 9 }),
    p(5, 'aldi', 'Huisman Mosterd variatie', { pack_text: '300-335 g' }), // multi-variant offer
  ])
  for (const id of [2, 4, 5]) {
    const g = groups.find((x) => x.members.some((m) => m.productId === id))
    assert.equal(g.members.length, 1, `product ${id} must stay single`)
  }
})
