import assert from 'node:assert/strict'
import test from 'node:test'
import { findFreshProducts } from '../scraper/retailer-search-api.mjs'

// Input-only product controls; null database proves refusal before SQLite I/O.
const ask = (ids, clock = new Date('2026-10-16T12:00:00Z')) =>
  findFreshProducts(null, ids, 'fictieve pasta', clock)

test('direct search rejects proxied arrays without reading or enumerating traps', () => {
  let called = 0
  const ids = new Proxy(['dirk'], {
    get() { called++; throw Error('get trap') },
    ownKeys() { called++; throw Error('ownKeys trap') },
  })
  assert.deepEqual(ask(ids), [])
  assert.equal(called, 0)
})

test('direct search reads no active own array index getters or custom iterators', () => {
  let called = 0
  const ids = ['dirk']
  Object.defineProperty(ids, '0', {
    enumerable: true, get() { called++; throw Error('index getter') },
  })
  assert.deepEqual(ask(ids), [])
  const iterator = ['dirk']
  iterator[Symbol.iterator] = () => { called++; throw Error('iterator') }
  assert.deepEqual(ask(iterator), [])
  assert.equal(called, 0)
})

test('direct search rejects spoofed, subclassed and proxied Date clocks', () => {
  let called = 0
  const clock = { getTime() { called++; throw Error('virtual clock') } }
  assert.deepEqual(ask(['dirk'], clock), [])
  class SpoofedDate extends Date {
    getTime() { called++; throw Error('override') }
  }
  assert.deepEqual(ask(['dirk'], new SpoofedDate()), [])
  assert.deepEqual(ask(['dirk'], new Proxy(new Date(), {})), [])
  assert.equal(called, 0)
})

test('direct search does not coerce non-string source IDs to keys', () => {
  let called = 0
  const id = { [Symbol.toPrimitive]() { called++; throw Error('key coercion') } }
  assert.deepEqual(ask([id]), [])
  assert.equal(called, 0)
  assert.deepEqual(ask(['dirk', 'nonexistent']), [])
})

test('valid inert-but-incomplete source and search inputs produce no DB access', () => {
  assert.deepEqual(ask([]), [])
  assert.deepEqual(findFreshProducts(null, ['dirk'], '', new Date()), [])
  assert.deepEqual(ask(Object.assign(Object.create(Array.prototype),
    { 0: 'dirk', length: 1 })), [])
})
