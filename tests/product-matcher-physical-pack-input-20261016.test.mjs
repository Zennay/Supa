import assert from 'node:assert/strict'
import test from 'node:test'
import { matchProducts } from '../scraper/lib/match.mjs'

// Completely inert same-brand mock sources, not observed retailer evidence.
const p = (id, retailer_id, amount, count = 1, gtins = []) => ({
  id, retailer_id, name:'Fictieve bio havervlokken', brand:'TESTMERK',
  gtins, pack_text:'500 g', pack_amount:amount, pack_unit:'g',
  pack_count:count,
})
const byId = (...products) => matchProducts(products).map(g=>
  g.members.map(member => member.productId).sort((a,b)=>a-b))
const separate = (a,b) => assert.deepEqual(byId(a,b), [[1],[2]])

test('zero physical pack quantity may not form a same-brand fuzzy equivalence', () => {
  separate(p(1,'dirk',0),p(2,'spar',0))
})

test('zero pack count must not silently be replaced by one when matching', () => {
  separate(p(1,'dirk',500,0),p(2,'spar',500,1))
})

test('fractional pack count cannot be used to join retailer packs', () => {
  separate(p(1,'dirk',500,1.5),p(2,'spar',500,1.5))
})

test('negative and nonfinite quantities abstain even when same EAN is present', () => {
  const gtin=['4006381333931']
  separate(p(1,'dirk',-500,1,gtin),p(2,'spar',-500,1,gtin))
  separate(p(1,'dirk',Number.POSITIVE_INFINITY,1,gtin),
    p(2,'spar',Number.POSITIVE_INFINITY,1,gtin))
})

test('known genuine equivalent 500g packs still match conservatively', () => {
  assert.deepEqual(byId(p(1,'dirk',500),p(2,'spar',500)),[[1,2]])
  assert.deepEqual(byId(p(1,'dirk',500,1,['4006381333931']),
    p(2,'spar',500,1,['4006381333931'])),[[1,2]])
})
