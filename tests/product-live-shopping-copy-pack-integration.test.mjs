import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'

// Integration into the already staged customer-facing shopping copy control.
// Every product and cent value below is controlled/synthetic, not retailer evidence.
function oneLine({ required = 600, unit = 'g', packAmount = 500,
  packUnit = 'g', packCount = 1, packs = 2, price = 199 } = {}) {
  return {
    store: { id: 'synthetic-store', name: 'Voorbeeldwinkel' },
    selectedMealCount: 1,
    lines: [{
      id: 'rice', ingredientLabel: 'Basmati rijst',
      requirement: { amount: required, unit },
      status: 'matched',
      productId: 'rice-pack', productName: 'Basmati rijst',
      pack: { amount: packAmount, unit: packUnit, count: packCount },
      packs, pricePerPackCents: price, lineTotalCents: packs * price,
      matchScore: 100, reasons: [],
    }],
    totalCents: packs * price, matchedLineCount: 1, unresolvedLineCount: 0,
  }
}

test('product #1356: visible-copy source refuses consistent but wasteful extra pack', () => {
  const valid = oneLine()
  assert.match(buildShoppingListCopyText(valid), /2 × 500/)
  const stale = oneLine({ packs: 3 })
  assert.equal(buildShoppingListCopyText(stale), null)
  assert.equal(stale.lines[0].lineTotalCents, 597, 'stale price remains self-consistent')
  assert.match(buildShoppingListCopyText(valid), /Basmati rijst/)
})

test('product #1356: one double-pack replaces two individual packs without price claims', () => {
  const multi = oneLine({ packCount: 2, packs: 1 })
  const valid = buildShoppingListCopyText(multi, ['rice'])
  assert.match(valid, /\[x\] Basmati rijst/)
  assert.match(valid, /1 × 2 × 500/)
  assert.doesNotMatch(valid, /€|besparing|goedkoper/i)
  assert.equal(buildShoppingListCopyText(oneLine({ packCount: 2, packs: 2 })), null)
})

test('product: exact decimal mass boundary does not invent a third pack', () => {
  const exact = oneLine({ required: 0.07, packAmount: 0.035, packs: 2 })
  assert.match(buildShoppingListCopyText(exact), /2 × 0,035/)
  assert.equal(buildShoppingListCopyText(oneLine({
    required: 0.07, packAmount: 0.035, packs: 3,
  })), null)
  const over = oneLine({ required: 0.0700001, packAmount: 0.035, packs: 3 })
  assert.match(buildShoppingListCopyText(over), /3 × 0,035/)
})

test('product: exact g/kg unit family and decimal edge preserve real physical demand', () => {
  const kg = oneLine({ required: 0.6, unit: 'kg', packAmount: 500, packUnit: 'g', packs: 2 })
  assert.match(buildShoppingListCopyText(kg), /2 × 500/)
  const wrong = oneLine({ required: 0.6, unit: 'l', packAmount: 500, packUnit: 'g', packs: 2 })
  assert.equal(buildShoppingListCopyText(wrong), null)
})

test('product: live canonical 11-demand basket copy remains price independent and conservative', () => {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
  assert.equal(basket.lines.length, 11)
  const before = JSON.stringify(basket)
  const text = buildShoppingListCopyText(basket)
  assert.match(text, /Boodschappenlijst/)
  assert.match(text, /product zelf kiezen/)
  assert.doesNotMatch(text, /€|besparing/)
  assert.equal(JSON.stringify(basket), before)

  const stale = { ...basket,
    lines: basket.lines.map(line => line.status === 'matched' && line.id === 'basmati-rice'
      ? { ...line, packs: line.packs + 1,
          lineTotalCents: (line.packs + 1) * line.pricePerPackCents }
      : line),
  }
  assert.equal(buildShoppingListCopyText(stale), null)
})

test('product: copy refuses invisible-only labels and throwing runtime inputs', () => {
  const invisible = oneLine()
  invisible.lines[0].productName = '\uFE0F\u0301'
  assert.equal(buildShoppingListCopyText(invisible), null)
  const hostile = oneLine()
  Object.defineProperty(hostile.lines[0], 'productName', {
    get() { throw Error('untrusted getter') },
  })
  assert.equal(buildShoppingListCopyText(hostile), null)
})

test('product: actual v2 ShoppingListView still wires the safe copy component to trusted ticks', () => {
  const source = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8',
  )
  assert.match(source, /ShoppingListCopyButton/)
  assert.match(source, /basket=\{basket\}/)
  assert.match(source, /doneLineIds=\{done\}/)
})
