import assert from 'node:assert/strict'
import test from 'node:test'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  shoppingListBasketKey, restoreShoppingListProgress, serializeShoppingListProgress,
} from '../src/features/shopping-list/shoppingListProgress.ts'

const basket = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
})
const matched = basket.lines.findIndex(line => line.status === 'matched')
const unresolved = basket.lines.findIndex(line => line.status === 'unresolved')
assert.ok(matched >= 0 && unresolved >= 0)

function assertRefused(candidate, label) {
  const trusted = serializeShoppingListProgress(basket, [basket.lines[matched].id])
  assert.deepEqual(restoreShoppingListProgress(candidate, trusted), [], label)
  for (const operation of [
    () => shoppingListBasketKey(candidate),
    () => serializeShoppingListProgress(candidate, [basket.lines[matched].id]),
  ]) {
    assert.throws(operation, {
      name: 'Error', message: 'Invalid shopping list basket runtime shape',
    }, label)
  }
}

test('v1 basket key rejects prototype-only root, store and physical-array facts', () => {
  assertRefused(Object.create(basket), 'inherited root')
  assertRefused({ ...basket, store: Object.create(basket.store) }, 'inherited store id')

  const inheritedArray = new Array(1)
  Object.setPrototypeOf(
    inheritedArray,
    Object.assign(Object.create(Array.prototype), { 0: basket.lines[0] }),
  )
  assertRefused({ ...basket, lines: inheritedArray }, 'inherited physical slot')

  const getterRoot = { ...basket }
  let accessed = 0
  Object.defineProperty(getterRoot, 'store', {
    enumerable: true,
    get() { accessed++; throw Error('SYNTHETIC_PRIVATE_FIELD') },
  })
  assertRefused(getterRoot, 'accessor root')
  assert.equal(accessed, 0, 'the untrusted root getter must never be invoked')
})

test('v1 key rejects inherited matched and unresolved financial/demand facts', () => {
  for (const [name, mutation] of [
    ['whole inherited line', (copy) => {
      copy.lines[matched] = Object.create(copy.lines[matched])
    }],
    ['inherited matched status', (copy) => {
      const line = copy.lines[matched]
      const { status, ...rest } = line
      copy.lines[matched] = Object.assign(Object.create({ status }), rest)
    }],
    ['inherited matched product', (copy) => {
      const line = copy.lines[matched]
      const { productId, ...rest } = line
      copy.lines[matched] = Object.assign(Object.create({ productId }), rest)
    }],
    ['inherited numeric pack count', (copy) => {
      const line = copy.lines[matched]
      const { count, ...rest } = line.pack
      line.pack = Object.assign(Object.create({ count }), rest)
    }],
    ['inherited demand unit', (copy) => {
      const line = copy.lines[matched]
      const { unit, ...rest } = line.requirement
      line.requirement = Object.assign(Object.create({ unit }), rest)
    }],
    ['inherited price cents', (copy) => {
      const line = copy.lines[matched]
      const { lineTotalCents, ...rest } = line
      copy.lines[matched] = Object.assign(Object.create({ lineTotalCents }), rest)
    }],
    ['inherited unresolved amount', (copy) => {
      const line = copy.lines[unresolved]
      const { amount, ...rest } = line.requirement
      line.requirement = Object.assign(Object.create({ amount }), rest)
    }],
  ]) {
    const copy = structuredClone(basket)
    mutation(copy)
    assertRefused(copy, name)
  }
})

test('v1 never executes hostile nested own getters or Proxy descriptor traps', () => {
  for (const [name, replace] of [
    ['productId getter', (copy, onCall) => {
      Object.defineProperty(copy.lines[matched], 'productId', {
        enumerable: true, get() { onCall(); return 'forged-id' },
      })
    }],
    ['requirement unit getter', (copy, onCall) => {
      Object.defineProperty(copy.lines[matched].requirement, 'unit', {
        enumerable: true, get() { onCall(); return 'g' },
      })
    }],
    ['pack count getter', (copy, onCall) => {
      Object.defineProperty(copy.lines[matched].pack, 'count', {
        enumerable: true, get() { onCall(); return 2 },
      })
    }],
  ]) {
    let calls = 0
    const copy = structuredClone(basket)
    replace(copy, () => { calls++ })
    assertRefused(copy, name)
    assert.equal(calls, 0, 'no potentially private getter invocation: ' + name)
  }
  const invalid = structuredClone(basket)
  invalid.lines[matched] = new Proxy(invalid.lines[matched], {
    getOwnPropertyDescriptor() { throw Error('SYNTHETIC_PRIVATE_PROXY') },
  })
  assertRefused(invalid, 'throwing descriptor trap')
})

test('v1 canonical persisted keys, 128 saved subsets and unresolved nonfinite sentinels stay compatible', () => {
  const original = structuredClone(basket)
  const key = shoppingListBasketKey(basket)
  assert.ok(key.includes(basket.store.id))
  const ids = basket.lines.slice(0, 7).map(line => line.id)
  for (let subset = 0; subset < 128; subset++) {
    const done = ids.filter((_, index) => (subset & (1 << index)) !== 0)
    const saved = serializeShoppingListProgress(basket, done)
    assert.equal(JSON.parse(saved).basketKey, key)
    assert.deepEqual(restoreShoppingListProgress(basket, saved), done)
  }
  const sentinels = [null, Number.NaN, Infinity, -Infinity, -0, 0]
  const distinct = new Set()
  for (const amount of sentinels) {
    const changed = structuredClone(basket)
    changed.lines[unresolved].requirement.amount = amount
    distinct.add(shoppingListBasketKey(changed))
  }
  assert.equal(distinct.size, sentinels.length)
  assert.deepEqual(basket, original)
})
