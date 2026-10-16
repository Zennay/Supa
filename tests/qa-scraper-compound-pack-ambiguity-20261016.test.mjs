import test from 'node:test'
import assert from 'node:assert/strict'

import { makeRecord, parsePack } from '../scraper/lib/normalize.mjs'

// Independent quality-validation contract: all products are fictional and
// processed in memory. No retailer URLs, network access, policy changes, or
// production catalog records are involved.
//
// A compound 'X + Y gratis' pack is not interchangeable with the primary
// 'X' quantity. Without a validated total physical quantity, conservative
// matching/whole-pack pricing must abstain instead of silently discarding
// the additional items or mass.
const COMPOUND_PACKS = [
  {
    title: '500 g + 200 g gratis cannot become a plain 500 g product',
    text: '500 g + 200 g gratis',
  },
  {
    title: '2 x 250 g + 1 x 250 g gratis cannot become a 2-pack',
    text: '2 x 250 g + 1 x 250 g gratis',
  },
  {
    title: '6 x 330 ml + 2 x 330 ml gratis cannot become a 6-pack',
    text: '6 x 330 ml + 2 x 330 ml gratis',
  },
  {
    title: '250 g + 25% extra cannot silently become a 250 g product',
    text: '250 g + 25% extra gratis',
  },
]

test('ordinary single and multipack sizes still normalize exactly', () => {
  assert.deepEqual(parsePack('500 g'), { amount: 500, unit: 'g', count: 1 })
  assert.deepEqual(parsePack('2 x 250 g'), { amount: 250, unit: 'g', count: 2 })
  assert.deepEqual(parsePack('6 × 330 ml'), { amount: 330, unit: 'ml', count: 6 })
  assert.deepEqual(parsePack('1 kg'), { amount: 1000, unit: 'g', count: 1 })
})

for (const { title, text } of COMPOUND_PACKS) {
  test(title, () => {
    assert.deepEqual(
      parsePack(text),
      { amount: null, unit: null, count: 1 },
      'ambiguous additional free/bonus quantities must be unknown, not a smaller payable physical pack',
    )
  })
}

test('normalized product records do not promote compound offer copy to measured pack facts', () => {
  const record = makeRecord({
    retailer: 'synthetic-store',
    sourceId: 'fixture-only',
    name: 'Fictional cereal bonus package',
    packText: '500 g + 200 g gratis',
    priceCents: 299,
    availability: 'available',
  })
  assert.equal(record.packAmount, null)
  assert.equal(record.packUnit, null)
  // Price can remain an archival fact, but not a trusted same-pack
  // cross-store comparison or per-unit savings basis.
  assert.equal(record.priceCents, 299)
})
