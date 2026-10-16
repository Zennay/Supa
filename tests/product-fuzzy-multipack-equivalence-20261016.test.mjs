import assert from 'node:assert/strict'
import test from 'node:test'
import { matchProducts, rebuildMatches } from '../scraper/lib/match.mjs'
import { ScrapeStore } from '../scraper/lib/db.mjs'

// Synthetic in-process mock article identity, no real retailer or price claims.
const article = (id,retailer_id,each=500,count=1,barcode=[]) => ({
  id,retailer_id,name:'Fictieve testrijst',brand:'TESTMERK',gtins:barcode,
  pack_text:each+' g',pack_amount:each,pack_unit:'g',
  pack_count:count,category:'synthetic',
})
const matched = (a,b) => matchProducts([a,b]).map(g=>g.members.map(m=>m.productId))
test('no-GTIN fuzzy path must not conflate 1×500g and 2×250g', () => {
  assert.deepEqual(matched(article(1,'dirk',500,1),article(2,'spar',250,2)),[[1],[2]])
})
test('same count and same pack mass remain eligible for conservative fuzzy matching', () => {
  assert.deepEqual(matched(article(1,'dirk',500,1),article(2,'spar',500,1)),[[1,2]])
  assert.deepEqual(matched(article(1,'dirk',250,2),article(2,'spar',250,2)),[[1,2]])
})
test('same EAN refuses a change in number of packs even with equal total', () => {
  const ean=['4006381333931']
  assert.deepEqual(matched(article(1,'dirk',500,1,ean),article(2,'spar',250,2,ean)),[[1],[2]])
})
test('invalid zero and fractional count do not enter fuzzy matching', () => {
  assert.deepEqual(matched(article(1,'dirk',500,0),article(2,'spar',500,1)),[[1],[2]])
  assert.deepEqual(matched(article(1,'dirk',500,1.5),article(2,'spar',500,1.5)),[[1],[2]])
})
test('real in-memory SQLite rebuild preserves two physically different basket pack lines', t => {
  const store=new ScrapeStore(':memory:')
  t.after(()=>store.close())
  for(const id of ['dirk','spar']){
    store.upsertRetailer({id,name:id,host:id+'.example.test',status:'inactive'})
    const count=id==='dirk'?1:2
    const each=id==='dirk'?500:250
    store.saveRecord({retailer:id,sourceId:'synthetic',url:'https://'+id+'.example.test/p',
      name:'Fictieve testrijst',brand:'TESTMERK',gtin:null,
      category:'synthetic',packText:each+' g',packAmount:each,
      packUnit:'g',packCount:count,imageUrl:null,priceCents:199,
      promoPriceCents:null,promoLabel:null,promoValidFrom:null,
      promoValidUntil:null,availability:'available'})
  }
  const outcome=rebuildMatches(store)
  assert.equal(outcome.canonical,2)
  assert.equal(outcome.multiRetailer,0)
  const rows=store.all('SELECT m.canonical_id AS id,p.pack_count AS n FROM product_matches m JOIN products p ON p.id=m.product_id ORDER BY p.retailer_id')
  assert.deepEqual(rows.map(r=>r.n),[1,2])
  assert.notEqual(rows[0].id,rows[1].id)
})
