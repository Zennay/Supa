import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent acceptance against the product owner's #355/#2578 v1 runtime
// boundary, without editing that owner branch. All amounts/prices are fixtures.
const basket = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
})
const matchedIndex = basket.lines.findIndex(line => line.status === 'matched')
const unresolvedIndex = basket.lines.findIndex(line => line.status === 'unresolved')
assert.ok(matchedIndex >= 0 && unresolvedIndex >= 0)

function changeLine(index, mutate) {
  const copy = structuredClone(basket)
  mutate(copy.lines[index])
  return copy
}
function expectRefused(candidate, label) {
  const marker = 'private-synthetic-marker-must-not-leak'
  let error
  try {
    shoppingListBasketKey(candidate)
  } catch (caught) {
    error = caught
  }
  assert.equal(error?.message, 'Invalid shopping list basket runtime shape', label)
  assert.deepEqual(restoreShoppingListProgress(candidate, JSON.stringify({
    schemaVersion: 1, basketKey: 'not-trusted', doneLineIds: [basket.lines[0].id],
  })), [], label)
  assert.throws(
    () => serializeShoppingListProgress(candidate, [basket.lines[0].id]),
    err => err instanceof Error &&
      err.message === 'Invalid shopping list basket runtime shape' &&
      !err.message.includes(marker),
    label,
  )
}

test('QA shopping v1: 112 numeric/shape mutations do not authorize storage', () => {
  const cases = [
    ['packs', [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2', null], 'packs'],
    ['pricePerPackCents', [-1, 0.1, NaN, Infinity, '100', null, undefined], 'pricePerPackCents'],
    ['lineTotalCents', [-1, 0.25, NaN, Infinity, '100', null, undefined], 'lineTotalCents'],
    ['pack.count', [0, -1, 0.5, NaN, Infinity, '2', null], 'pack'],
    ['pack.amount', [0, -1, NaN, Infinity, '200', null, undefined], 'pack'],
    ['requirement.amount', [0, -1, NaN, Infinity, '100', null, undefined], 'requirement'],
    ['productId', ['', '    ', null, undefined, 12, {}, []], 'productId'],
    ['pack.unit', ['', 'unknown-invalid', null, undefined, 12, {}, []], 'pack'],
    ['requirement.unit', ['', 'fake', null, undefined, 12, {}, []], 'requirement'],
  ]
  let tested = 0
  for (const [label, values, field] of cases) {
    for (const value of values) {
      const candidate = changeLine(matchedIndex, line => {
        if (field === 'pack') line.pack[label.split('.')[1]] = value
        else if (field === 'requirement') line.requirement[label.split('.')[1]] = value
        else line[field] = value
      })
      expectRefused(candidate, label + ': ' + String(value))
      tested++
    }
  }
  for (const bad of [
    null, undefined, {}, [], 'basket',
    { ...basket, store: null },
    { ...basket, store: { id: '' } },
    { ...basket, store: { id: '  ' } },
    { ...basket, lines: null },
    { ...basket, lines: 'abc' },
    { ...basket, lines: Array(2) },
    { ...basket, lines: [basket.lines[0], basket.lines[0]] },
    { ...basket, lines: [{ ...basket.lines[0], status: 'forged' }] },
    { ...basket, lines: [{ ...basket.lines[0], id: '' }] },
    { ...basket, lines: [{ ...basket.lines[0], requirement: null }] },
  ]) {
    expectRefused(bad, 'invalid top-level or duplicate lines')
    tested++
  }
  assert.equal(tested, 78)
})

test('QA shopping v1: unresolved numeric sentinels have 11 distinct physical keys', () => {
  const values = [
    null, NaN, Infinity, -Infinity, -0, 0, -1, 1, 1.5,
    Number.MIN_VALUE, Number.MAX_VALUE,
  ]
  const keys = new Set()
  for (const amount of values) {
    const candidate = changeLine(unresolvedIndex, line => {
      line.requirement.amount = amount
    })
    const before = structuredClone(candidate)
    const key = shoppingListBasketKey(candidate)
    assert.ok(key.includes(candidate.lines[unresolvedIndex].id))
    assert.ok(!keys.has(key), 'distinct unresolved numeric state must not collide')
    keys.add(key)
    const done = [candidate.lines[unresolvedIndex].id]
    const serialized = serializeShoppingListProgress(candidate, done)
    assert.deepEqual(restoreShoppingListProgress(candidate, serialized), done)
    assert.deepEqual(candidate, before)
  }
  assert.equal(keys.size, values.length)
})

test('QA shopping v1: all 128 saved-ID subsets preserve old valid schema and filtered row identities', () => {
  const ids = basket.lines.slice(0, 7).map(line => line.id)
  assert.equal(new Set(ids).size, 7)
  const original = structuredClone(basket)
  const key = shoppingListBasketKey(basket)
  for (let mask = 0; mask < 128; mask++) {
    const done = ids.filter((_, index) => mask & (1 << index))
    const raw = serializeShoppingListProgress(basket, [
      ...done, ...done, 'unrelated-shopping-basket', null, 123,
    ])
    const saved = JSON.parse(raw)
    assert.equal(saved.schemaVersion, 1)
    assert.equal(saved.basketKey, key)
    assert.deepEqual(saved.doneLineIds, done)
    assert.deepEqual(restoreShoppingListProgress(basket, raw), done)
    assert.deepEqual(restoreShoppingListProgress({ ...basket, store: { id: 'another-store' } }, raw), [])
  }
  assert.deepEqual(basket, original)
})

test('QA shopping v1: corrupted objects, revoked proxies and hostile accessors fail closed without private diagnostics', () => {
  const good = serializeShoppingListProgress(basket, [basket.lines[0].id])
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  const hostile = { store: basket.store, lines: basket.lines }
  Object.defineProperty(hostile, 'store', {
    enumerable: true,
    get() { throw Error('private-synthetic-marker-must-not-leak') },
  })
  for (const input of [revoked.proxy, hostile]) {
    assert.deepEqual(restoreShoppingListProgress(input, good), [])
    expectRefused(input, 'revoked or hostile basket')
  }
  for (const state of [
    '{bad JSON',
    JSON.stringify({ schemaVersion: 2, basketKey: shoppingListBasketKey(basket), doneLineIds: [basket.lines[0].id] }),
    JSON.stringify({ schemaVersion: 1, basketKey: 'foreign-basket', doneLineIds: [basket.lines[0].id] }),
    JSON.stringify({ schemaVersion: 1, basketKey: shoppingListBasketKey(basket), doneLineIds: [null, 1, 'unknown'] }),
  ]) {
    assert.deepEqual(restoreShoppingListProgress(basket, state), [])
  }
})