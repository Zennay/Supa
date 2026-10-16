import assert from 'node:assert/strict'
import test from 'node:test'
import { findFreshProducts } from '../scraper/retailer-search-api.mjs'

// Independent M3 quality acceptance for an explicitly exported pure search API.
// Invalid untrusted direct JavaScript arguments must be refused *before* they
// trigger caller code or an SQLite read. Database null is deliberate: a safe
// early rejection must not touch an unknown database.
test('direct search rejects Proxy-wrapped approved source IDs without invoking traps', () => {
  let traps = 0
  const ids = new Proxy(['dirk'], {
    get() {
      traps += 1
      throw Error('PRIVATE_QA_SOURCE_PROXY_GET_SHOULD_NOT_RUN')
    },
  })
  assert.deepEqual(findFreshProducts(null, ids, 'fictieve pasta', new Date('2026-10-16T12:00:00Z')), [])
  assert.equal(traps, 0, 'caller Proxy.get ran before source admission')
})

test('direct search rejects active getters inside retailer source array', () => {
  let calls = 0
  const ids = ['dirk']
  Object.defineProperty(ids, '0', {
    enumerable: true,
    configurable: true,
    get() {
      calls += 1
      throw Error('PRIVATE_QA_SOURCE_ID_GETTER_SHOULD_NOT_RUN')
    },
  })
  assert.deepEqual(findFreshProducts(null, ids, 'fictieve pasta', new Date('2026-10-16T12:00:00Z')), [])
  assert.equal(calls, 0, 'caller source ID getter ran before source admission')
})

test('direct search refuses arbitrary clock.getTime without invoking it', () => {
  let calls = 0
  const hostile = {
    getTime() {
      calls += 1
      throw Error('PRIVATE_QA_SEARCH_CLOCK_METHOD_SHOULD_NOT_RUN')
    },
  }
  assert.deepEqual(findFreshProducts(null, ['dirk'], 'fictieve pasta', hostile), [])
  assert.equal(calls, 0, 'untrusted clock method executed')
})

test('direct search rejects subclassed Date override without virtual method calls', () => {
  let calls = 0
  class SpoofDate extends Date {
    getTime() {
      calls += 1
      throw Error('PRIVATE_QA_SEARCH_DATE_OVERRIDE_SHOULD_NOT_RUN')
    }
  }
  assert.deepEqual(findFreshProducts(null, ['dirk'], 'fictieve pasta',
    new SpoofDate('2026-10-16T12:00:00Z')), [])
  assert.equal(calls, 0, 'overridden Date.getTime ran before source admission')
})

test('invalid inert direct-search input still returns no candidate prices', () => {
  assert.deepEqual(findFreshProducts(null, [], 'fictieve pasta', new Date()), [])
  assert.deepEqual(findFreshProducts(null, ['dirk'], '', new Date()), [])
})
