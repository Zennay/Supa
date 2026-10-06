import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

test('basket total fails closed when individually safe line totals overflow together', () => {
  const hugePriceCents = Math.floor(Number.MAX_SAFE_INTEGER / 2)
  const products = m2Products.map((product) =>
    product.id === 'broccoli-500' || product.id === 'coconut-400'
      ? { ...product, priceCents: hugePriceCents }
      : product,
  )

  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })

  const broccoli = basket.lines.find((line) => line.id === 'broccoli')
  assert.ok(broccoli)
  assert.equal(broccoli.status, 'matched')
  assert.equal(broccoli.lineTotalCents, hugePriceCents)

  const coconut = basket.lines.find((line) => line.id === 'coconut-milk')
  assert.ok(coconut)
  assert.equal(coconut.status, 'unresolved')
  assert.match(
    coconut.reasons.join(' '),
    /basket monetary total exceeds the safe integer range/,
  )

  assert.equal(basket.matchedLineCount, 9)
  assert.equal(basket.unresolvedLineCount, 2)
  assert.equal(Number.isSafeInteger(basket.totalCents), true)

  const recomputedTotal = basket.lines.reduce(
    (total, line) =>
      line.status === 'matched' ? total + line.lineTotalCents : total,
    0,
  )
  assert.equal(basket.totalCents, recomputedTotal)
  assert.equal(Number.isSafeInteger(recomputedTotal), true)
})
