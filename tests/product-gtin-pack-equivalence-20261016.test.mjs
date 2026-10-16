import assert from 'node:assert/strict'
import test from 'node:test'
import { matchProducts } from '../scraper/lib/match.mjs'

// Fictional, valid demo EAN; no real retailer, SKU, price or network.
const make = (id, retailer_id, amount=500, unit='g', count=1, extra={}) => ({
  id, retailer_id, name:'Fictieve havermeel', brand:'FICTIE',
  gtins:['4006381333931'], pack_text:`${amount} ${unit}`,
  pack_amount:amount, pack_unit:unit, pack_count:count, ...extra,
})
const groupsOf = (...items) => matchProducts(items).map(g =>
  g.members.map(m=>m.productId).sort((a,b)=>a-b))
const distinct = (...items) =>
  assert.deepEqual(groupsOf(...items), items.map(i=>[i.id]))

test('shared EAN does not override contradictory mass, volume or multipack count', () => {
  distinct(make(1,'dirk',250),make(2,'spar',500))
  distinct(make(1,'dirk',500,'g'),make(2,'spar',500,'ml'))
  distinct(make(1,'dirk',250,'g',1),make(2,'spar',250,'g',2))
  distinct(make(1,'dirk',500,'g',1),make(2,'spar',250,'g',2))
})

test('same EAN and trusted equal physical 500g pack remains comparable', () => {
  assert.deepEqual(groupsOf(make(1,'dirk'),make(2,'spar')), [[1,2]])
})

test('unknown, malformed or ranged GTIN pack facts abstain', () => {
  distinct(make(1,'dirk'), make(2,'spar',null,'g',1,{pack_text:''}))
  distinct(make(1,'dirk'), make(2,'spar',500,'g',0))
  distinct(make(1,'dirk'), make(2,'spar',500,'g',1.5))
  distinct(make(1,'dirk'), make(2,'spar',500,'g',1,{pack_text:'350-390 g'}))
})

test('GTIN linking cannot bridge two physically incompatible clusters', () => {
  assert.deepEqual(groupsOf(
    make(1,'dirk',500), make(2,'spar',1000), make(3,'plus',500),
  ), [[1,3], [2]])
})

test('two GTINs on bridge SKU cannot join incompatible quantity clusters', () => {
  const a = make(1,'dirk',500,'g',1,{gtins:['4006381333931']})
  const b = make(2,'spar',1000,'g',1,{gtins:['5012345678900']})
  const c = make(3,'plus',500,'g',1,{gtins:['4006381333931','5012345678900']})
  const grouped = groupsOf(a,b,c)
  assert.equal(grouped.length, 2)
  assert.ok(grouped.some(g=>g.length===1 && g[0]===2))
})
