import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2Store, m2InitialPlan, m2Recipes, m2Products, m2DefaultActiveDays,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function basket(activeDays = m2DefaultActiveDays, products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays, products,
  })
}

test('copies current shopping quantities and checkboxes without inventing prices', () => {
  const current = basket()
  const before = JSON.stringify(current)
  const matched = current.lines.find(line => line.status === 'matched')
  assert.ok(matched)
  const output = buildShoppingListCopyText(current, [matched.id])
  assert.ok(output)
  assert.ok(output.startsWith('Boodschappenlijst — ' + m2Store.name))
  assert.ok(output.includes('[x] ' + matched.productName + ' — ' + matched.packs + ' × '))
  assert.ok(output.includes('nodig: '))
  assert.ok(output.includes('Eigen planning'))
  assert.ok(output.includes('Bloemkool'))
  assert.ok(output.includes('stuks'))
  assert.doesNotMatch(output, /€|besparing|euro|prijsverschil/i)
  assert.equal(JSON.stringify(current), before)
})

test('re-pricing the same physical basket never alters a portable shopping checklist', () => {
  const current = basket()
  const changed = basket(
    m2DefaultActiveDays,
    m2Products.map(product => ({ ...product, priceCents: product.priceCents + 1 })),
  )
  assert.equal(buildShoppingListCopyText(current), buildShoppingListCopyText(changed))
})

test('empty active week copies a truthful no-shopping state', () => {
  const output = buildShoppingListCopyText(basket([]))
  assert.ok(output)
  assert.ok(output.includes('Er zijn nog geen boodschappen gepland.'))
  assert.doesNotMatch(output, /\[ \]|\[x\]|€/)
})

test('unresolved product is explicitly manual without invented product identity', () => {
  const current = basket()
  const first = current.lines[0]
  const unresolved = {
    ...first, status: 'unresolved', requirement: first.requirement,
    reasons: ['no candidates'], matchScore: null,
  }
  const snapshot = {
    ...current, lines: [unresolved],
    matchedLineCount: 0, unresolvedLineCount: 1,
  }
  const output = buildShoppingListCopyText(snapshot)
  assert.ok(output)
  assert.ok(output.includes(first.ingredientLabel + ' — product zelf kiezen'))
  assert.ok(output.includes('1 productkeuze(s) nog niet bepaald.'))
  assert.doesNotMatch(output, /€|gratis/)
})

test('an untrusted snapshot, corrupt pack, changed counts or stale checks fail closed', () => {
  const current = basket()
  const firstMatched = current.lines.find(line => line.status === 'matched')
  assert.ok(firstMatched)
  assert.equal(buildShoppingListCopyText(current, ['missing-ingredient']), null)
  assert.equal(buildShoppingListCopyText({ ...current, lines: {} }), null)
  assert.equal(buildShoppingListCopyText({ ...current, matchedLineCount: 999 }), null)
  assert.equal(buildShoppingListCopyText({
    ...current, lines: [...current.lines, current.lines[0]],
  }), null)
  assert.equal(buildShoppingListCopyText({
    ...current, lines: current.lines.map(line => line.id === firstMatched.id
      ? { ...line, pack: { ...line.pack, count: 0 } } : line),
  }), null)
  assert.equal(buildShoppingListCopyText({
    ...current, lines: current.lines.map(line => line.id === firstMatched.id
      ? { ...line, lineTotalCents: line.lineTotalCents + 1 } : line),
  }), null)
  assert.equal(buildShoppingListCopyText({
    ...current, lines: current.lines.map(line => line.id === firstMatched.id
      ? { ...line, status: 'unknown-status' } : line),
  }), null)
})

test('product label line breaks and bidirectional controls cannot insert checkbox rows', () => {
  const current = basket()
  const firstMatched = current.lines.find(line => line.status === 'matched')
  assert.ok(firstMatched)
  const safeSnapshot = {
    ...current,
    lines: current.lines.map(line => line.id === firstMatched.id
      ? { ...line, productName: 'Rijst\n[x] Gratis\u202e\nExtra' }
      : line),
  }
  const output = buildShoppingListCopyText(safeSnapshot)
  assert.ok(output)
  assert.ok(output.includes('Rijst [x] Gratis Extra'))
  assert.equal(output.split('\n').filter(line => line.startsWith('[x]')).length, 0)
})

test('copy interface exposes selectable readonly content without privileged clipboard calls', async () => {
  const component = await readFile(
    new URL('../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url), 'utf8',
  )
  assert.ok(component.includes('type="button"'))
  assert.ok(component.includes('onClick={toggleExport}'))
  assert.ok(component.includes('readOnly'))
  assert.ok(component.includes('onFocus={event => event.currentTarget.select()}'))
  assert.ok(component.includes('aria-expanded={expanded}'))
  assert.ok(component.includes('Boodschappenlijst om te kopiëren'))
  assert.ok(component.includes('Kopieer op je apparaat'))
  assert.ok(!component.includes('navigator.clipboard'))
  assert.ok(!component.includes('fetch('))
})
