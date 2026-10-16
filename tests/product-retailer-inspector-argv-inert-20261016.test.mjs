import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { main } from '../scripts/retailer-inspect-snapshot-cli.mjs'

// CLI is normally passed process.argv; these are programmatic JS counterfactuals.
// Refusal must happen before SHA verification or any private HTML path access.
const html = '<article class="product-card">offline-only</article>'
const args = () => [
  'plus',
  'https://www.plus.nl/producten',
  '2026-10-14T12:00:00.000Z',
  createHash('sha256').update(html).digest('hex'),
  '/__supa_nonexistent_private_inspector_argv_guard__/private.html',
]

test('offline HTML inspector refuses Proxy argv without triggering get traps', async () => {
  let calls = 0
  const hostile = new Proxy(args(), {
    get(target, key) { calls++; return Reflect.get(target, key) },
  })
  await assert.rejects(main(hostile), /Usage: inspect-snapshot/)
  assert.equal(calls, 0)
})

test('offline HTML inspector refuses accessor argv slots without triggering getter', async () => {
  for (const index of [0, 1, 2, 3, 4]) {
    const hostile = args()
    let calls = 0
    Object.defineProperty(hostile, index, {
      enumerable: true, get() { calls++; return args()[index] },
    })
    await assert.rejects(main(hostile), /Usage: inspect-snapshot/)
    assert.equal(calls, 0)
  }
})

test('offline HTML inspector refuses sparse, symbol and exotic argv values before path access', async () => {
  const sparse = args()
  delete sparse[2]
  const symbol = args()
  symbol[Symbol('hidden')] = 'secret'
  const objectValue = args()
  objectValue[1] = { toString() { throw new Error('coercion executed') } }
  for (const invalid of [sparse, symbol, objectValue, null]) {
    await assert.rejects(main(invalid), /Usage: inspect-snapshot/)
  }
})
