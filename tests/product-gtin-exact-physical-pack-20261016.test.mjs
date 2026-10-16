import assert from 'node:assert/strict'
import test from 'node:test'
import { matchProducts, rebuildMatches } from '../scraper/lib/match.mjs'
import { ScrapeStore } from '../scraper/lib/db.mjs'

// All input is entirely fictional with structurally valid public demo EAN.
const barcode = '4006381333931'
function product(id, retailer_id, amount=500, gtins=[barcode]) {
  return { id, retailer_id, name:'Fictieve cacao', brand:'TEST ONLY',
    gtins, pack_text:amount+' g', pack_amount:amount,
    pack_unit:'g', pack_count:1, category:'synthetic' }
}
const groups = items => matchProducts(items).map(g => g.members.map(m=>m.productId))
test('same barcode cannot merge 500g and 504g under fuzzy-only ±1% tolerance', () => {
  assert.deepEqual(groups([product(1,'dirk',500),product(2,'spar',504)]),[[1],[2]])
})
test('same barcode cannot merge a smaller fractional quantity difference', () => {
  assert.deepEqual(groups([product(1,'dirk',500),product(2,'spar',500.1)]),[[1],[2]])
})
test('same barcode and identical valid 500g physical amounts still match', () => {
  assert.deepEqual(groups([product(1,'dirk'),product(2,'spar')]),[[1,2]])
})
test('the fuzzy-only heuristic remains separate for unbarcoded matching', () => {
  // Genuine name-only identity is still an explicitly lower-confidence
  // heuristic. Even when pack rounding places items in different blocks, the
  // exact-EAN fix must not modify fuzzy name/brand/pack scoring.
  assert.equal(groups([product(1,'dirk',500,[]),product(2,'spar',500,[])]).length,1)
})
test('actual read/write SQLite remains conflict-safe and preserves source barcode', t => {
  const store=new ScrapeStore(':memory:')
  t.after(()=>store.close())
  for(const id of ['dirk','spar']){
    store.upsertRetailer({id,name:id,host:id+'.example.test',status:'inactive'})
  }
  const add=(id,amount)=>store.saveRecord({
    retailer:id, sourceId:'test'+amount,
    url:'https://'+id+'.example.test/item',
    name:'Fictieve cacao',brand:'TEST ONLY',gtin:barcode,
    category:'synthetic',packText:amount+' g',
    packAmount:amount,packUnit:'g',packCount:1,imageUrl:null,
    priceCents:250,promoPriceCents:null,promoLabel:null,
    promoValidFrom:null,promoValidUntil:null,availability:'available',
  })
  add('dirk',500);add('spar',504)
  const outcome=rebuildMatches(store)
  assert.equal(outcome.canonical,2)
  assert.equal(outcome.multiRetailer,0)
  const rows=store.all('SELECT m.canonical_id AS id,c.gtin AS canonical, g.gtin AS source FROM product_matches m JOIN canonical_products c ON c.id=m.canonical_id JOIN product_gtins g ON g.product_id=m.product_id ORDER BY m.product_id')
  assert.equal(rows.length,2)
  assert.notEqual(rows[0].id,rows[1].id)
  assert.deepEqual(rows.map(r=>r.canonical),[null,null])
  assert.deepEqual(rows.map(r=>r.source),[barcode,barcode])
  assert.equal(rebuildMatches(store).canonical,2)
})
