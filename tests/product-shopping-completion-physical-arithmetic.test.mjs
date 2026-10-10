import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'

function fresh() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
}
function checkAll(basket) {
  return shoppingListCompletion(basket, basket.lines.map((line) => line.id))
}

test('shopping completion rejects overflow and subnormal physical packages without changing source', async (t) => {
  const source = fresh()
  for (const [name, mutate] of [
    ['subnormal pack', (line) => { line.pack.amount = Number.MIN_VALUE }],
    ['effective quantity overflow', (line) => {
      line.pack.amount = 1e308
      line.pack.count = Number.MAX_SAFE_INTEGER
    }],
    ['zero normalized package', (line) => { line.pack.amount = 1e-325 }],
    ['missing package count', (line) => { delete line.pack.count }],
    ['non-integer demand', (line) => { line.requirement.amount = Infinity }],
  ]) {
    await t.test(name, () => {
      const basket = structuredClone(source)
      const line = basket.lines.find((candidate) => candidate.status === 'matched')
      assert.ok(line)
      mutate(line)
      const snapshot = structuredClone(basket)
      const result = checkAll(basket)
      assert.equal(result.state, 'invalid')
      assert.equal(result.checkedCount, 0)
      assert.deepEqual(basket, snapshot)
    })
  }
})

test('empty shopping week is still empty; forged nonzero totals cannot become empty or complete', () => {
  const empty = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: [], products: m2Products,
  })
  assert.equal(checkAll(empty).state, 'empty')
  assert.equal(checkAll({ ...empty, totalCents: 10 }).state, 'invalid')
  const full = fresh()
  assert.equal(checkAll(full).state, 'complete')
  assert.equal(checkAll({ ...full, totalCents: full.totalCents + 1 }).state, 'invalid')
})
