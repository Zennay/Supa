import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { serializeShoppingProgressV2 } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

function changed(kind, id) {
  const value = structuredClone(basket())
  const matched = value.lines.find((line) => line.status === 'matched')
  assert.ok(matched, 'controlled M2 fixture should contain a matched item')
  if (kind === 'store') value.store.id = id
  if (kind === 'line') matched.id = id
  if (kind === 'product') matched.productId = id
  return value
}

const invisible = [
  ['combining accent', '\u0301'],
  ['emoji variation selector', '\ufe0f'],
  ['zero-width space', '\u200b'],
  ['zero-width joiner', '\u200d'],
]

for (const [name, id] of invisible) {
  test(`v2 physical shopping key must reject ${name}-only store identity`, () => {
    const input = changed('store', id)
    const before = structuredClone(input)
    assert.equal(shoppingListDemandIdentity(input), null)
    assert.equal(serializeShoppingProgressV2(input, [input.lines[0].id]), null)
    assert.deepEqual(input, before, 'validation must not mutate source basket')
  })
}

test('v2 physical shopping key must reject mark-only matched line identity', () => {
  assert.equal(shoppingListDemandIdentity(changed('line', '\u0301')), null)
})

test('v2 physical shopping key must reject format-only matched product identity', () => {
  assert.equal(shoppingListDemandIdentity(changed('product', '\u200b')), null)
})

test('v2 physical IDs preserve real visible bases, including Dutch, emoji, and accents', () => {
  const baseline = basket()
  assert.notEqual(shoppingListDemandIdentity(baseline), null)
  for (const id of ['winkel-123', 'e\u0301', 'winkel-\u200d-station', 'markt-🥦', '...']) {
    for (const kind of ['store', 'line', 'product']) {
      assert.notEqual(shoppingListDemandIdentity(changed(kind, id)), null, `${kind}: ${id}`)
    }
  }
})
