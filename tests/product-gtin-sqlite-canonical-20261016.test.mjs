import assert from 'node:assert/strict'
import test from 'node:test'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { rebuildMatches } from '../scraper/lib/match.mjs'

// All rows, prices and canonical rights are synthetic and private in memory.
// This exercises the REAL SQLite UNIQUE canonical GTIN constraint, not only
// an in-process match function. It never calls HTTP or starts a source crawl.
const EAN = '4006381333931'
function memoryStore(t) {
  const store = new ScrapeStore(':memory:')
  t.after(() => store.close())
  for (const id of ['dirk', 'spar', 'plus']) {
    store.upsertRetailer({
      id, name:id, host:id + '.example.test', status:'inactive', notes:'fictional',
    })
  }
  return store
}
function add(store, retailer, size, count=1, barcode=EAN) {
  return store.saveRecord({
    retailer, sourceId:'fictitious-' + size + '-' + count,
    url:'https://' + retailer + '.example.test/product',
    name:'Fictief testproduct', brand:'TEST ONLY',
    gtin:barcode, extraGtins:[], category:'fictional',
    packText:size + ' g', packAmount:size, packUnit:'g', packCount:count,
    imageUrl:null, priceCents:250, promoPriceCents:null,
    promoLabel:null, promoValidFrom:null, promoValidUntil:null,
    availability:'available',
  })
}
const pairs = store => store.all(
  'SELECT p.retailer_id AS store, m.canonical_id AS id, c.gtin AS gtin ' +
  'FROM product_matches m JOIN products p ON p.id=m.product_id ' +
  'JOIN canonical_products c ON c.id=m.canonical_id ORDER BY p.retailer_id'
)

test('physical pack contradiction writes two separate SQLite canonical IDs without UNIQUE conflict', t => {
  const store = memoryStore(t)
  add(store,'dirk',250)
  add(store,'spar',500)
  const summary = rebuildMatches(store)
  assert.equal(summary.canonical, 2)
  assert.equal(summary.multiRetailer, 0)
  const rows = pairs(store)
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].id, rows[1].id)
  assert.deepEqual(rows.map(x=>x.gtin), [null,null])
  assert.equal(store.get('SELECT COUNT(*) AS n FROM product_gtins').n, 2,
    'original per-retailer barcode evidence must not be erased')
})

test('same barcode and same trustworthy pack writes one SQLite canonical with EAN retained', t => {
  const store = memoryStore(t)
  add(store,'dirk',500)
  add(store,'spar',500)
  const summary = rebuildMatches(store)
  assert.equal(summary.canonical, 1)
  assert.equal(summary.multiRetailer, 1)
  const rows = pairs(store)
  assert.equal(rows[0].id, rows[1].id)
  assert.deepEqual(rows.map(x=>x.gtin), [EAN,EAN])
})

test('one coherent barcode pair and one contradictory pack remain safely split on SQLite repeat runs', t => {
  const store = memoryStore(t)
  add(store,'dirk',500)
  add(store,'spar',500)
  add(store,'plus',1000)
  const first = rebuildMatches(store)
  assert.equal(first.canonical, 2)
  assert.equal(first.multiRetailer, 1)
  const rows = pairs(store)
  assert.equal(rows[0].id, rows[2].id)
  assert.notEqual(rows[0].id, rows[1].id)
  assert.ok(rows.every(row=>row.gtin===null))
  const again = rebuildMatches(store)
  assert.equal(again.canonical, 2)
  assert.equal(again.multiRetailer, 1)
  assert.equal(store.get('SELECT COUNT(*) AS n FROM product_matches').n, 3)
})
