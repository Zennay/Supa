import test from 'node:test'
import assert from 'node:assert/strict'

import { makeRecord, normalizeAvailability } from '../scraper/lib/normalize.mjs'

// Independent, in-process fictional adapter QA. Real inventory, retailer
// sources, transport and permission registers must never be consulted here.
//
// String matching must fail closed: a token 'InStock' inside a *negated* or
// contradictory availability sentence does not prove an article is for sale.
test('well-formed explicitly available and unavailable statuses remain distinct', () => {
  assert.equal(normalizeAvailability(true), 'available')
  assert.equal(normalizeAvailability(false), 'unavailable')
  assert.equal(normalizeAvailability('https://schema.org/InStock'), 'available')
  assert.equal(normalizeAvailability('https://schema.org/OutOfStock'), 'unavailable')
  assert.equal(normalizeAvailability('https://schema.org/Discontinued'), 'unavailable')
  assert.equal(normalizeAvailability('https://schema.org/PreOrder'), 'unavailable')
  assert.equal(normalizeAvailability('unknown'), 'unknown')
})

for (const status of [
  'NotInStock',
  'InStock / OutOfStock',
  'OutOfStock, InStock',
  'InStock but Discontinued',
]) {
  test(`contradictory or negated source status ${JSON.stringify(status)} must not claim in stock`, () => {
    assert.notEqual(
      normalizeAvailability(status),
      'available',
      'ambiguous source inventory cannot be presented as definitely available',
    )
  })
}

test('a record derived from contradictory availability does not become an available stock fact', () => {
  const row = makeRecord({
    retailer: 'fictional-store',
    sourceId: 'fictional-item',
    name: 'Imaginary cereal',
    packText: '500 g',
    availability: normalizeAvailability('InStock but Discontinued'),
    priceCents: 250,
  })
  assert.notEqual(row.availability, 'available')
  assert.equal(row.priceCents, 250)
})
