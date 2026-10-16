/**
 * Independent M3 QA for inclusive byte-budget boundaries on the additive
 * private catalog snapshot. Synthetic scalars and arrays only: no retailer
 * HTTP, current prices, rights, personal data or publication.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  snapshotBoundedPrivateCatalogInput as snapshot,
  PRIVATE_CATALOG_BUDGET as LIMIT,
} from '../scripts/retailer-private-budgeted-catalog.mjs'

const refused = /Private offline catalog input refused/

test('UTF-8-per-scalar boundary admits exactly 1 MiB of multibyte emoji, refuses +4 bytes', () => {
  const exact = '🛒'.repeat(LIMIT.perStringUtf8Bytes / 4)
  assert.equal(Buffer.byteLength(exact), LIMIT.perStringUtf8Bytes)
  const original = { marker: exact }
  const pinned = snapshot(original)
  assert.equal(pinned.marker, exact)
  assert.ok(Object.isFrozen(pinned))
  assert.notEqual(pinned, original)
  assert.throws(() => snapshot({ marker: exact + '🛒' }), refused)
})

test('aggregate primitive + key UTF-8 boundary admits exactly 2 MiB, rejects one more byte', () => {
  const half = LIMIT.perStringUtf8Bytes
  // Keys 'a' and 'b' cost one byte each. Exactly 2*(MiB-1)+2
  // consumes the entire combined primitive/key budget.
  const data = { a: 'a'.repeat(half - 1), b: 'b'.repeat(half - 1) }
  const pinned = snapshot(data)
  assert.deepEqual(pinned, data)
  assert.ok(Object.isFrozen(pinned))
  const justOver = { ...data, b: 'b'.repeat(half) }
  assert.throws(() => snapshot(justOver), refused)
})

test('primitive keys and values both count, including otherwise unused UTF-8 keys', () => {
  const exactKey = 'é'.repeat(LIMIT.perStringUtf8Bytes / 2)
  assert.equal(Buffer.byteLength(exactKey), LIMIT.perStringUtf8Bytes)
  const exact = Object.create(null)
  exact[exactKey] = 'ok'
  const copied = snapshot(exact)
  assert.equal(copied[exactKey], 'ok')
  assert.ok(Object.isFrozen(copied))
  const longKey = 'é'.repeat(LIMIT.perStringUtf8Bytes / 2 + 1)
  const rejected = Object.create(null)
  rejected[longKey] = 'ok'
  assert.throws(() => snapshot(rejected), refused)
})

test('bounded private copy preserves dense 10,000-element array but denies length 10,001', () => {
  const exact = Array.from({ length: LIMIT.maxArrayLength }, (_, index) => index % 2 === 0)
  const copied = snapshot(exact)
  assert.deepEqual(copied, exact)
  assert.ok(Object.isFrozen(copied))
  assert.throws(() => snapshot(new Array(LIMIT.maxArrayLength + 1).fill(false)), refused)
})
