import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { serializeShoppingListProgress } from '../src/features/shopping-list/shoppingListProgress.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'
import {
  reconcileTrustedShoppingProgressV2, restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2, toggleTrustedShoppingProgressV2,
  upgradeTrustedLegacyProgressV1,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

function basket(products = m2Products, store = m2Store) {
  return buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products,
  })
}

function reprice(current) {
  const line = current.lines.find((row) => row.status === 'matched')
  assert.ok(line)
  return basket(m2Products.map((product) => product.id === line.productId
    ? { ...product, priceCents: product.priceCents + 1 }
    : product))
}

function invalidVariants(original) {
  return [
    ['wrong family', (line) => { line.pack.unit = 'l' }],
    ['underbuy', (line) => { line.pack.amount = 0.00001 }],
    ['invented pack', (line) => { line.packs += 1 }],
  ].map(([name, mutate]) => {
    const changed = structuredClone(original)
    const line = changed.lines.find((item) => item.status === 'matched')
    assert.ok(line)
    mutate(line)
    return [name, changed]
  }).concat([
    ['empty plan with shopping', { ...original, selectedMealCount: 0 }],
    ['unbalanced matched count', { ...original, matchedLineCount: original.matchedLineCount + 1 }],
    ['negative unresolved', { ...original, unresolvedLineCount: -1 }],
    ['stale total', { ...original, totalCents: original.totalCents + 1 }],
  ])
}

test('valid repricing keeps v2 checked lines after same-session and reload', () => {
  const current = basket()
  const next = reprice(current)
  const checked = [current.lines[0].id]
  const state = serializeTrustedShoppingProgressV2(current, checked)
  assert.ok(state)
  assert.equal(shoppingListProgressV2StorageKey, 'supa:shopping-list-progress:v2')
  assert.notEqual(next.totalCents, current.totalCents)
  assert.deepEqual(restoreTrustedShoppingProgressV2(next, state), checked)
  assert.deepEqual(reconcileTrustedShoppingProgressV2(current, next, checked), checked)
  assert.deepEqual(toggleTrustedShoppingProgressV2(next, checked, checked[0]), [])
})

test('v1 is upgraded only if current legacy price-sensitive basket still matches', () => {
  const current = basket()
  const checked = [current.lines[0].id]
  const v1 = serializeShoppingListProgress(current, checked)
  const v2 = upgradeTrustedLegacyProgressV1(current, v1)
  assert.ok(v2)
  assert.equal(JSON.parse(v2).schemaVersion, 2)
  assert.deepEqual(restoreTrustedShoppingProgressV2(current, v2), checked)
  assert.equal(upgradeTrustedLegacyProgressV1(reprice(current), v1), null)
  assert.deepEqual(restoreTrustedShoppingProgressV2(reprice(current), v2), checked)
})

test('all five trusted v2 boundaries fail closed on physically invalid snapshots', async (t) => {
  const source = basket()
  const checked = [source.lines[0].id]
  const saved = serializeTrustedShoppingProgressV2(source, checked)
  const v1 = serializeShoppingListProgress(source, checked)
  assert.ok(saved)
  for (const [label, invalid] of invalidVariants(source)) {
    await t.test(label, () => {
      const before = structuredClone(invalid)
      assert.equal(isTrustworthyShoppingBasket(invalid), false)
      assert.equal(serializeTrustedShoppingProgressV2(invalid, checked), null)
      assert.deepEqual(restoreTrustedShoppingProgressV2(invalid, saved), [])
      assert.deepEqual(toggleTrustedShoppingProgressV2(invalid, [], checked[0]), [])
      assert.deepEqual(reconcileTrustedShoppingProgressV2(source, invalid, checked), [])
      assert.deepEqual(reconcileTrustedShoppingProgressV2(invalid, source, checked), [])
      assert.equal(upgradeTrustedLegacyProgressV1(invalid, v1), null)
      assert.deepEqual(invalid, before)
    })
  }
})

test('store or matched-product changes invalidate checks despite previous v2 JSON', () => {
  const source = basket()
  const checked = [source.lines[0].id]
  const saved = serializeTrustedShoppingProgressV2(source, checked)
  assert.ok(saved)

  const storeChanged = { ...source, store: { ...source.store, id: 'other-store' } }
  assert.equal(isTrustworthyShoppingBasket(storeChanged), true)
  assert.deepEqual(restoreTrustedShoppingProgressV2(storeChanged, saved), [])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(source, storeChanged, checked), [])

  const productChanged = structuredClone(source)
  const first = productChanged.lines.find((line) => line.status === 'matched')
  first.productId += '-new'
  assert.equal(isTrustworthyShoppingBasket(productChanged), true)
  assert.deepEqual(restoreTrustedShoppingProgressV2(productChanged, saved), [])
})

test('genuine zero-cent coherent rows remain valid without treating null as free', () => {
  const source = basket()
  const zero = structuredClone(source)
  zero.totalCents = 0
  zero.lines.forEach((line) => {
    if (line.status === 'matched') {
      line.pricePerPackCents = 0
      line.lineTotalCents = 0
    }
  })
  assert.equal(isTrustworthyShoppingBasket(zero), true)
  assert.ok(serializeTrustedShoppingProgressV2(zero, [zero.lines[0].id]))
  assert.equal(serializeTrustedShoppingProgressV2({ ...zero, totalCents: null }, []), null)
})

test('read-only safe progress never mutates checked arrays or basket state', () => {
  const source = basket()
  const before = structuredClone(source)
  const checked = Object.freeze([source.lines[0].id])
  const raw = serializeTrustedShoppingProgressV2(source, checked)
  assert.ok(raw)
  assert.deepEqual(restoreTrustedShoppingProgressV2(source, raw), checked)
  assert.deepEqual(checked, [source.lines[0].id])
  assert.deepEqual(source, before)
})
