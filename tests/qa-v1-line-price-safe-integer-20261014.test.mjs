import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  shoppingListBasketKey, restoreShoppingListProgress, serializeShoppingListProgress,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent exact-safe-integer controls added alongside the byte-identical
// original expected-RED suite. Controlled demo data, never retailer evidence.
const canonical = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
})
const index = canonical.lines.findIndex(line => line.status === 'matched')
assert.ok(index >= 0)
const id = canonical.lines[index].id
const raw = serializeShoppingListProgress(canonical, [id])

function replaceFinancial({ pricePerPackCents, lineTotalCents, packs }) {
  const value = structuredClone(canonical)
  Object.assign(value.lines[index], {
    pricePerPackCents, lineTotalCents, packs,
  })
  return value
}
function reject(value) {
  assert.deepEqual(restoreShoppingListProgress(value, raw), [])
  for (const operation of [
    () => shoppingListBasketKey(value),
    () => serializeShoppingListProgress(value, [id]),
  ]) {
    assert.throws(operation, {
      name: 'Error', message: 'Invalid shopping list basket runtime shape',
    })
  }
}

test('QA: overflowing multiplication is never a valid persisted completed basket', () => {
  const max = Number.MAX_SAFE_INTEGER
  for (const values of [
    { packs: 2, pricePerPackCents: max, lineTotalCents: max },
    { packs: 2, pricePerPackCents: (max + 1) / 2, lineTotalCents: max - 1 },
    { packs: max, pricePerPackCents: 2, lineTotalCents: max },
  ]) {
    const copy = replaceFinancial(values)
    const before = structuredClone(copy)
    reject(copy)
    assert.deepEqual(copy, before)
  }
})

test('QA: coherent maximum-safe and zero-price snapshots preserve exact old v1 format', () => {
  const max = Number.MAX_SAFE_INTEGER
  const coherent = [
    { packs: 1, pricePerPackCents: max, lineTotalCents: max },
    { packs: 2, pricePerPackCents: Math.floor(max / 2), lineTotalCents: max - 1 },
    { packs: canonical.lines[index].packs, pricePerPackCents: 0, lineTotalCents: 0 },
  ]
  for (const values of coherent) {
    const copy = replaceFinancial(values)
    const before = structuredClone(copy)
    const key = shoppingListBasketKey(copy)
    assert.deepEqual(JSON.parse(key).lines[index], {
      id: canonical.lines[index].id,
      status: 'matched',
      amount: canonical.lines[index].requirement.amount,
      unit: canonical.lines[index].requirement.unit,
      productId: canonical.lines[index].productId,
      packs: values.packs,
      packAmount: canonical.lines[index].pack.amount,
      packUnit: canonical.lines[index].pack.unit,
      packCount: canonical.lines[index].pack.count,
      pricePerPackCents: values.pricePerPackCents,
      lineTotalCents: values.lineTotalCents,
    })
    const saved = serializeShoppingListProgress(copy, [id])
    assert.deepEqual(restoreShoppingListProgress(copy, saved), [id])
    assert.deepEqual(copy, before)
  }
})

test('QA: untrusted price objects never coerce through Symbol.toPrimitive', () => {
  let calls = 0
  const value = structuredClone(canonical)
  value.lines[index].pricePerPackCents = {
    [Symbol.toPrimitive]() {
      calls++
      throw Error('QA_PRIVATE_NONNUMERIC_PRICE_NOT_FOR_PUBLIC_OUTPUT')
    },
  }
  reject(value)
  assert.equal(calls, 0)
})
