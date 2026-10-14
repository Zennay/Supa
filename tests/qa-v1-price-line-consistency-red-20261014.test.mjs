import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import {
  restoreShoppingListProgress, serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent synthetic QA. No live retailer prices or observation/savings claims.
const basket = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
})
const index = basket.lines.findIndex(line =>
  line.status === 'matched' && line.packs > 0 && line.pricePerPackCents > 1)
assert.ok(index >= 0)
const id = basket.lines[index].id

function corrupt(changes) {
  const value = structuredClone(basket)
  Object.assign(value.lines[index], changes)
  return value
}

function checkProgressRejects(value, name) {
  const knownRaw = serializeShoppingListProgress(basket, [id])
  assert.equal(buildShoppingListCopyText(value), null,
    `portable physical-copy validation must already refuse ${name}`)
  assert.deepEqual(restoreShoppingListProgress(value, knownRaw), [],
    `no restored checked rows from inconsistent financial facts ${name}`)
  assert.throws(() => shoppingListBasketKey(value), {
    name: 'Error',
    message: 'Invalid shopping list basket runtime shape',
  }, name)
  assert.throws(() => serializeShoppingListProgress(value, [id]), {
    name: 'Error',
    message: 'Invalid shopping list basket runtime shape',
  }, name)
}

test('QA expected RED: shopping-v1 stored checked states reject independently inconsistent positive pack prices', async t => {
  const line = basket.lines[index]
  const original = structuredClone(basket)
  assert.equal(line.lineTotalCents, line.packs * line.pricePerPackCents)
  const cases = [
    ['one-cent underpayment', { lineTotalCents: line.lineTotalCents - 1 }],
    ['one-cent overpayment', { lineTotalCents: line.lineTotalCents + 1 }],
    ['zero total despite purchased packs', { lineTotalCents: 0 }],
    ['wrong positive unit price', { pricePerPackCents: line.pricePerPackCents + 1 }],
    ['one extra pack with stale row total', { packs: line.packs + 1 }],
    ['free unit price with paid row total', { pricePerPackCents: 0 }],
    ['changed paid row total', { lineTotalCents: 1 }],
  ]
  for (const [name, changes] of cases) {
    await t.test(name, () => {
      const value = corrupt(changes)
      const before = structuredClone(value)
      checkProgressRejects(value, name)
      assert.deepEqual(value, before, 'caller-owned basket remains unchanged')
    })
  }
  assert.deepEqual(basket, original)
})

test('QA positive: original real-layout demo fixtures still serialize byte-for-byte canonical v1 key', () => {
  const original = JSON.stringify({
    storeId: basket.store.id,
    lines: basket.lines.map(line => line.status === 'matched' ? ({
      id: line.id, status: line.status,
      amount: line.requirement.amount, unit: line.requirement.unit,
      productId: line.productId, packs: line.packs,
      packAmount: line.pack.amount, packUnit: line.pack.unit,
      packCount: line.pack.count, pricePerPackCents: line.pricePerPackCents,
      lineTotalCents: line.lineTotalCents,
    }) : ({
      id: line.id, status: line.status,
      amount: line.requirement.amount, unit: line.requirement.unit,
    })),
  })
  assert.equal(shoppingListBasketKey(basket), original)
  const serialized = serializeShoppingListProgress(basket, [id, id, 'foreign-qa-id'])
  assert.deepEqual(restoreShoppingListProgress(basket, serialized), [id])
  assert.deepEqual(JSON.parse(serialized), {
    schemaVersion: 1, basketKey: original, doneLineIds: [id],
  })
})

test('QA positive: coherent repricing of a physical product remains valid and invalidates old persisted checks', () => {
  const value = structuredClone(basket)
  value.lines[index].pricePerPackCents += 1
  value.lines[index].lineTotalCents =
    value.lines[index].packs * value.lines[index].pricePerPackCents
  value.totalCents += value.lines[index].packs
  assert.equal(shoppingListBasketKey(value).includes('\"pricePerPackCents\"'), true)
  const raw = serializeShoppingListProgress(value, [id])
  assert.deepEqual(restoreShoppingListProgress(value, raw), [id])
  const prior = serializeShoppingListProgress(basket, [id])
  assert.deepEqual(restoreShoppingListProgress(value, prior), [])
  assert.equal(buildShoppingListCopyText(value), buildShoppingListCopyText(basket))
})
