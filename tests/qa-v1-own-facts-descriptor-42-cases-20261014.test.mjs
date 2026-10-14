import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  shoppingListBasketKey, restoreShoppingListProgress, serializeShoppingListProgress,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent read-only QA against product owner's frozen source branch #2581.
// Synthetic demo basket only, not live M3 price or retailer evidence.
const basket = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
})
const matchedIndex = basket.lines.findIndex(line => line.status === 'matched')
const unknownIndex = basket.lines.findIndex(line => line.status === 'unresolved')
assert.ok(matchedIndex >= 0 && unknownIndex >= 0)
const trustedId = basket.lines[matchedIndex].id
const originalKey = shoppingListBasketKey(basket)
const originalRaw = serializeShoppingListProgress(basket, [trustedId])

function basketCopy() { return structuredClone(basket) }
function rejectCopy(copy, reason) {
  assert.deepEqual(restoreShoppingListProgress(copy, originalRaw), [], reason)
  for (const fn of [
    () => shoppingListBasketKey(copy),
    () => serializeShoppingListProgress(copy, [trustedId]),
  ]) {
    assert.throws(fn, {
      name: 'Error', message: 'Invalid shopping list basket runtime shape',
    }, reason)
  }
}
const route = [
  ['basket.store', value => value, 'store'],
  ['basket.lines', value => value, 'lines'],
  ['store.id', value => value.store, 'id'],
  ['matched.id', value => value.lines[matchedIndex], 'id'],
  ['matched.status', value => value.lines[matchedIndex], 'status'],
  ['matched.requirement', value => value.lines[matchedIndex], 'requirement'],
  ['matched.requirement.amount', value => value.lines[matchedIndex].requirement, 'amount'],
  ['matched.requirement.unit', value => value.lines[matchedIndex].requirement, 'unit'],
  ['matched.productId', value => value.lines[matchedIndex], 'productId'],
  ['matched.packs', value => value.lines[matchedIndex], 'packs'],
  ['matched.pack', value => value.lines[matchedIndex], 'pack'],
  ['matched.pack.amount', value => value.lines[matchedIndex].pack, 'amount'],
  ['matched.pack.unit', value => value.lines[matchedIndex].pack, 'unit'],
  ['matched.pack.count', value => value.lines[matchedIndex].pack, 'count'],
  ['matched.pricePerPackCents', value => value.lines[matchedIndex], 'pricePerPackCents'],
  ['matched.lineTotalCents', value => value.lines[matchedIndex], 'lineTotalCents'],
  ['unknown.id', value => value.lines[unknownIndex], 'id'],
  ['unknown.status', value => value.lines[unknownIndex], 'status'],
  ['unknown.requirement', value => value.lines[unknownIndex], 'requirement'],
  ['unknown.requirement.amount', value => value.lines[unknownIndex].requirement, 'amount'],
  ['unknown.requirement.unit', value => value.lines[unknownIndex].requirement, 'unit'],
]
test('QA owner facts: 21 own-accessor traps cannot observe or impersonate a saved shopping decision', async t => {
  for (const [label, holder, field] of route) {
    await t.test(label, () => {
      const copy = basketCopy()
      const target = holder(copy)
      const old = target[field]
      let calls = 0
      Object.defineProperty(target, field, {
        configurable: true, enumerable: true,
        get() {
          calls++
          throw Error('QA_SYNTHETIC_PRIVATE_FACT_SHOULD_NOT_RUN')
        },
      })
      rejectCopy(copy, label)
      assert.equal(calls, 0, 'never invoke untrusted own accessor: ' + label)
      assert.notEqual(old, undefined)
    })
  }
})

test('QA owner facts: 21 inherited replacements are never treated as own basket identity', async t => {
  for (const [label, holder, field] of route) {
    await t.test(label, () => {
      const copy = basketCopy()
      const target = holder(copy)
      const inherited = target[field]
      assert.equal(Object.hasOwn(target, field), true, label)
      delete target[field]
      Object.setPrototypeOf(target, { [field]: inherited })
      assert.equal(Object.hasOwn(target, field), false, label)
      rejectCopy(copy, label)
    })
  }
})

test('QA owner facts: inherited physical array slots and accessor slots fail closed without touching callback', () => {
  const copy = basketCopy()
  const lost = copy.lines[matchedIndex]
  delete copy.lines[matchedIndex]
  assert.equal(Object.hasOwn(copy.lines, String(matchedIndex)), false)
  const inherited = Object.create(Array.prototype)
  Object.defineProperty(inherited, String(matchedIndex), {
    value: lost, configurable: true, enumerable: true,
  })
  Object.setPrototypeOf(copy.lines, inherited)
  rejectCopy(copy, 'inherited array slot')

  const second = basketCopy()
  let reads = 0
  Object.defineProperty(second.lines, String(matchedIndex), {
    configurable: true, enumerable: true,
    get() {
      reads++
      throw Error('QA_SYNTHETIC_PRIVATE_ARRAY_GETTER')
    },
  })
  rejectCopy(second, 'accessor array slot')
  assert.equal(reads, 0)
})

test('QA owner facts: same genuine own values remain backward compatible with 128 saved-subsets', () => {
  const before = basketCopy()
  assert.equal(shoppingListBasketKey(basket), originalKey)
  const ids = basket.lines.slice(0, 7).map(line => line.id)
  assert.equal(new Set(ids).size, 7)
  for (let mask = 0; mask < 128; mask++) {
    const selected = ids.filter((_, index) => mask & (1 << index))
    const raw = serializeShoppingListProgress(basket, [
      ...selected, ...selected, 'foreign-synthetic-row',
    ])
    assert.deepEqual(restoreShoppingListProgress(basket, raw), selected)
    assert.equal(JSON.parse(raw).basketKey, originalKey)
  }
  assert.deepEqual(basket, before)
})
