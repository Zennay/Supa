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

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function assertInvalid(value, raw) {
  assert.deepEqual(restoreShoppingListProgress(value, raw), [])
  assert.throws(
    () => shoppingListBasketKey(value),
    (error) => error instanceof Error &&
      error.message === 'Invalid shopping list basket runtime shape',
  )
  assert.throws(
    () => serializeShoppingListProgress(value, []),
    (error) => error instanceof Error &&
      error.message === 'Invalid shopping list basket runtime shape',
  )
}

test('shopping v1 persistence never executes or leaks hostile getter errors', () => {
  const valid = basket()
  const raw = serializeShoppingListProgress(valid, [valid.lines[0].id])
  let attempted = 0
  const hostileStore = {
    get id() {
      attempted += 1
      throw Error('SYNTHETIC_SECRET_MUST_NOT_ESCAPE')
    },
    name: 'Fictional',
  }
  const malformed = { ...valid, store: hostileStore }
  assertInvalid(malformed, raw)
  assert.ok(attempted >= 3)
  const revoked = Proxy.revocable(valid, {})
  revoked.revoke()
  assertInvalid(revoked.proxy, raw)
  const getterLine = { ...valid.lines[0] }
  Object.defineProperty(getterLine, 'requirement', {
    enumerable: true,
    get() { throw Error('SYNTHETIC_RECIPE_SECRET') },
  })
  assertInvalid({ ...valid, lines: [getterLine, ...valid.lines.slice(1)] }, raw)
})

test('shopping v1 persistence rejects price/pack arithmetic drift before saving ticks', () => {
  const valid = basket()
  const matchedIndex = valid.lines.findIndex((line) => line.status === 'matched')
  assert.ok(matchedIndex >= 0)
  const raw = serializeShoppingListProgress(valid, [valid.lines[matchedIndex].id])
  for (const patch of [
    { lineTotalCents: valid.lines[matchedIndex].lineTotalCents + 1 },
    { pricePerPackCents: valid.lines[matchedIndex].pricePerPackCents + 1 },
    { packs: valid.lines[matchedIndex].packs + 1 },
    { lineTotalCents: Number.MAX_SAFE_INTEGER, packs: Number.MAX_SAFE_INTEGER },
  ]) {
    const malformed = structuredClone(valid)
    Object.assign(malformed.lines[matchedIndex], patch)
    assertInvalid(malformed, raw)
  }
  assert.deepEqual(
    restoreShoppingListProgress(valid, raw),
    [valid.lines[matchedIndex].id],
  )
})

test('normal v1 persisted key and legitimate cent-only price refresh remain distinguishable', () => {
  const original = basket()
  const first = original.lines.findIndex((line) => line.status === 'matched')
  assert.ok(first >= 0)
  const raw = serializeShoppingListProgress(original, [original.lines[first].id])
  assert.deepEqual(restoreShoppingListProgress(original, raw), [original.lines[first].id])
  const repriced = structuredClone(original)
  repriced.lines[first].pricePerPackCents += 1
  repriced.lines[first].lineTotalCents =
    repriced.lines[first].packs * repriced.lines[first].pricePerPackCents
  assert.notEqual(shoppingListBasketKey(original), shoppingListBasketKey(repriced))
  assert.deepEqual(restoreShoppingListProgress(repriced, raw), [])
})
