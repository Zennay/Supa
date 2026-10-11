import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

// Independent postrepair acceptance on real ShoppingListCopyButton integration.
// The prices/products are test-only and must never imply retailer savings.
function basket(activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays,
  })
}

test('independent product: valid priced basket copy is unchanged by price-only repricing', () => {
  const original = basket()
  const completedIds = original.lines.filter(x => x.status === 'matched').slice(0, 2).map(x => x.id)
  const before = buildShoppingListCopyText(original, completedIds)
  assert.ok(before)
  assert.match(before, /\[x\]/)
  const repriced = {
    ...original,
    lines: original.lines.map(line => line.status === 'matched'
      ? { ...line,
        pricePerPackCents: line.pricePerPackCents + 123,
        lineTotalCents: line.packs * (line.pricePerPackCents + 123) }
      : line),
  }
  const after = buildShoppingListCopyText(repriced, completedIds)
  assert.equal(after, before)
  assert.doesNotMatch(after, /€|besparing|goedkoper/)
})

test('independent product: stale physical pack count cannot hide behind repriced cents', () => {
  const original = basket()
  const changed = {
    ...original,
    lines: original.lines.map(line => line.status === 'matched' && line.id === 'basmati-rice'
      ? { ...line, packs: line.packs + 1,
          pricePerPackCents: line.pricePerPackCents + 1,
          lineTotalCents: (line.packs + 1) * (line.pricePerPackCents + 1) }
      : line),
  }
  assert.equal(buildShoppingListCopyText(changed), null)
  assert.ok(buildShoppingListCopyText(original))
})

test('independent product: empty shopping week stays truthful and full controlled list unchanged', () => {
  const empty = basket([])
  assert.equal(empty.lines.length, 0)
  assert.match(buildShoppingListCopyText(empty), /Er zijn nog geen boodschappen gepland/)
  const full = basket()
  const before = JSON.stringify(full)
  const text = buildShoppingListCopyText(full)
  assert.match(text, /Basmati rijst/)
  assert.equal(JSON.stringify(full), before)
})

test('independent product: revoked physical array and hostile checked ids fail closed', () => {
  const data = basket()
  const { proxy, revoke } = Proxy.revocable(data.lines, {})
  revoke()
  assert.equal(buildShoppingListCopyText({ ...data, lines: proxy }), null)
  const checked = ['basmati-rice']
  Object.defineProperty(checked, '0', {
    get() { throw Error('getter must not crash live copy') },
  })
  assert.equal(buildShoppingListCopyText(data, checked), null)
})
