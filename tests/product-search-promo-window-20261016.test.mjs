import assert from 'node:assert/strict'
import test from 'node:test'
import { ScrapeStore } from '../scraper/lib/db.mjs'
import { getAdapter } from '../scraper/adapters/index.mjs'
import { findFreshProducts } from '../scraper/retailer-search-api.mjs'

// Fictional in-memory observations: NO approved source, live HTTP, or price publication.
const now = new Date('2026-10-16T12:00:00.000Z')
const product = (from, until) => ({
  retailer:'dirk', sourceId:'PRIVATE-ONLY-CACAO', name:'Private fictional cacao 500g',
  brand:'Not a real product', url:'https://www.dirk.nl/producten/private-fictional-cacao',
  category:'Only for tests', packText:'500 g', packAmount:500, packUnit:'g',
  packCount:1, imageUrl:null, gtin:null, extraGtins:[],
  priceCents:249, promoPriceCents:99,
  promoLabel:'Imaginary promotional window', promoValidFrom:from, promoValidUntil:until,
  availability:'available',
})
function store(t, from, to) {
  const db = new ScrapeStore(':memory:')
  t.after(() => db.close())
  db.upsertRetailer(getAdapter('dirk'))
  db.saveRecord(product(from,to),{at:now.toISOString()})
  return db
}
function review(db) {
  const found = findFreshProducts(db.db,['dirk'],'fictional cacao',now)
  assert.equal(found.length,1)
  assert.equal(found[0].regularPriceCents,249)
  return found[0]
}
for (const [label, from, until, discounted] of [
  ['future start','2026-10-17T00:00:00.000Z','2026-10-18T00:00:00.000Z',false],
  ['reversed window','2026-10-18T00:00:00.000Z','2026-10-17T00:00:00.000Z',false],
  ['expired','2026-10-14T00:00:00.000Z','2026-10-15T23:59:59.000Z',false],
  ['active','2026-10-16T10:00:00.000Z','2026-10-17T00:00:00.000Z',true],
  ['exact start','2026-10-16T12:00:00.000Z','2026-10-17T00:00:00.000Z',true],
  ['exact end','2026-10-16T10:00:00.000Z','2026-10-16T12:00:00.000Z',true],
  ['unknown start',null,'2026-10-17T00:00:00.000Z',true],
  ['malformed start','2026-10-16bad','2026-10-17T00:00:00.000Z',false],
]) {
  test('fictional retailer promotion ' + label + ' cannot silently misprice', t => {
    const db = store(t,from,until)
    const row = review(db)
    assert.equal(row.offer, discounted)
    assert.equal(row.priceCents, discounted ? 99 : 249)
  })
}
test('two captures differing only in campaign start time persist as distinct SQLite price rows', t => {
  const db = store(t,'2026-10-17T00:00:00.000Z','2026-10-18T00:00:00.000Z')
  assert.equal(review(db).offer,false)
  const original = db.get('SELECT COUNT(*) AS total FROM prices').total
  assert.equal(original,1)
  db.saveRecord(product('2026-10-15T00:00:00.000Z','2026-10-18T00:00:00.000Z'),
    {at:now.toISOString()})
  const updated = db.get('SELECT COUNT(*) AS total FROM prices').total
  assert.equal(updated,2,'a revised campaign start is a distinct observed price fact')
  assert.equal(review(db).offer,true)
  assert.equal(review(db).priceCents,99)
})
