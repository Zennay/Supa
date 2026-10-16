import test from 'node:test'
import assert from 'node:assert/strict'

import { toCents } from '../scraper/lib/normalize.mjs'

// Independent offline monetary admission contract for final payable prices.
// Values with a third fractional decimal cannot be truthfully normalized
// into exact cents by implicit Math.round; keep them unknown and let the
// product-side owner explicitly handle any separately sourced unit prices.
// Fictional scalar strings only: no network, prices, DB or retailer traffic.
test('ordinary Dutch and machine final checkout prices remain cent-exact', () => {
  assert.equal(toCents('2,99'), 299)
  assert.equal(toCents('2.99'), 299)
  assert.equal(toCents('€ 2,90'), 290)
  assert.equal(toCents('€ 1.234,56'), 123456)
  assert.equal(toCents('2'), 200)
  assert.equal(toCents('2,5'), 250)
  assert.equal(toCents(2.99), 299)
})

for (const [label, value] of [
  ['comma fraction with 3 decimals', '2,999'],
  ['dot fraction with 3 decimals', '2.999'],
  ['subcent comma price', '0,005'],
  ['subcent dot price', '0.009'],
  ['ambiguous standalone Dutch thousands grouping', '1.234'],
]) {
  test(`unverified ${label} must not silently round to a different payable price`, () => {
    assert.equal(toCents(value), null)
  })
}

test('non-price scalars and sign manipulation remain rejected', () => {
  for (const candidate of ['', 'abc', '-1,00', 'NaN', undefined, null, {}, []]) {
    assert.equal(toCents(candidate), null)
  }
})
