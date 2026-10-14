import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Target direction-spoofing + terminal/PDF line control characters, not normal
// accented Dutch letters, combining accents, emoji or harmless punctuation.
const BAD_DISPLAY = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]/u
const hostileCharacters = [
  ['right-to-left override', String.fromCodePoint(0x202e)],
  ['bidi isolate', String.fromCodePoint(0x2066)],
  ['zero-width space', String.fromCodePoint(0x200b)],
  ['paragraph separator', String.fromCodePoint(0x2029)],
  ['embedded newline', String.fromCodePoint(0x000a)],
  ['embedded tab', String.fromCodePoint(0x0009)],
  ['embedded NUL', String.fromCodePoint(0x0000)],
]

function inputBasket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

function evaluate(mutator) {
  const input = structuredClone(inputBasket())
  mutator(input)
  const original = structuredClone(input)
  const result = preparePrintableShoppingChecklist(input)
  assert.deepEqual(input, original, 'render must not mutate evidence/basket')
  assert.equal(result.lines.length, input.lines.length, 'cannot drop planned rows')
  assert.deepEqual(result.lines.map((x) => x.id), input.lines.map((x) => x.id))
  assert.equal(result.reviewCount, result.lines.filter((x) => x.needsReview).length)
  assert.doesNotMatch(JSON.stringify(result),
    /"priceCents"|"totalCents"|"savingsCents"|"participantKey"/)
  return result
}

test('positive: normal Dutch accents, hyphenation and emoji stay readable on paper', () => {
  const result = evaluate((basket) => {
    basket.store.name = 'Café Markt – Leiden'
    const matched = basket.lines.find((line) => line.status === 'matched')
    assert.ok(matched)
    matched.productName = 'Crème fraîche 🥣 – biologisch'
  })
  assert.equal(result.storeLabel, 'Café Markt – Leiden')
  const row = result.lines.find((r) => r.label === 'Crème fraîche 🥣 – biologisch')
  assert.ok(row, 'Unicode product remains visible, not falsely stripped')
  assert.equal(row.needsReview, false)
})

test('positive: unavailable line stays manually reviewed without fabricating money', () => {
  const result = evaluate((basket) => {
    const row = basket.lines.find((line) => line.status === 'matched')
    assert.ok(row)
    row.status = 'unresolved'
    row.ingredientLabel = 'Crème fraîche 🥣'
  })
  assert.ok(result.lines.some((row) => row.needsReview && row.label === 'Crème fraîche 🥣'))
})

test('EXPECTED RED: a printable matched product cannot silently retain directional or line controls', () => {
  for (const [name, marker] of hostileCharacters) {
    const result = evaluate((basket) => {
      const row = basket.lines.find((line) => line.status === 'matched')
      assert.ok(row)
      row.productName = `Normale ${marker} verpakking`
    })
    const matchedRow = result.lines.find((row) => row.label.includes('Normale'))
    if (matchedRow && !matchedRow.needsReview) {
      assert.doesNotMatch(matchedRow.label, BAD_DISPLAY,
        `${name}: trusted product copy must contain no display-control bytes`)
    } else {
      assert.ok(result.lines.some((row) => row.needsReview),
        `${name}: abstain to explicit manual choice when raw product copy is untrusted`)
    }
  }
})

test('EXPECTED RED: retailer/store title cannot retain bidi or embedded controls', () => {
  for (const [name, marker] of hostileCharacters) {
    const result = evaluate((basket) => {
      basket.store.name = `Voorbeeld ${marker} Winkel`
    })
    assert.doesNotMatch(result.storeLabel, BAD_DISPLAY,
      `${name}: printed store heading cannot mislead visual inspection`)
  }
})

test('EXPECTED RED: manual fallback ingredient title cannot retain bidi or embedded controls', () => {
  for (const [name, marker] of hostileCharacters) {
    const result = evaluate((basket) => {
      const row = basket.lines.find((line) => line.status === 'matched')
      assert.ok(row)
      row.status = 'unresolved'
      row.ingredientLabel = `Boodschap ${marker} normaal`
    })
    const lines = result.lines.filter((row) => row.needsReview)
    assert.ok(lines.length > 0)
    for (const line of lines) {
      assert.doesNotMatch(line.label, BAD_DISPLAY,
        `${name}: even manual copy must not carry bidi or C0 controls to paper`)
    }
  }
})
