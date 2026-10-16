import assert from 'node:assert/strict'
import test from 'node:test'
import { matchProducts } from '../scraper/lib/match.mjs'

// Offline synthetic GTIN pack-trust QA. A barcode that points to two
// physically incompatible packs is contradictory source evidence, not
// permission to compare their full-pack prices as equal basket choices.
const fictional = (id, retailer_id, pack_amount, pack_unit='g', pack_count=1) => ({
  id, retailer_id, name:'Fictieve testcacao', brand:'TEST ONLY',
  gtins:['4006381333931'], // structurally valid public EAN demo, not observed product
  pack_text:`${pack_amount} ${pack_unit}`, pack_amount, pack_unit,
  pack_count, category:'synthetic',
})

function bothRetailersMustRemainSeparate(items) {
  const groups = matchProducts(items)
  assert.equal(groups.length, 2, 'contradictory pack sizes must never share a price comparison identity')
  for (const group of groups) assert.equal(group.members.length, 1)
}

test('one barcode must NOT merge two different total gram packs', () => {
  bothRetailersMustRemainSeparate([
    fictional(1, 'dirk', 250), fictional(2, 'spar', 500),
  ])
})

test('one barcode must NOT merge gram quantity with millilitre quantity', () => {
  bothRetailersMustRemainSeparate([
    fictional(1, 'dirk', 500, 'g'), fictional(2, 'spar', 500, 'ml'),
  ])
})

test('one barcode must NOT merge one pack with a two-pack of the same amount', () => {
  bothRetailersMustRemainSeparate([
    fictional(1, 'dirk', 250, 'g', 1), fictional(2, 'spar', 250, 'g', 2),
  ])
})

test('same barcode and same total measured pack may still form one cross-store group', () => {
  const groups = matchProducts([fictional(1, 'dirk', 500), fictional(2, 'spar', 500)])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].members.map(x => x.productId).sort((a,b)=>a-b), [1,2])
})
