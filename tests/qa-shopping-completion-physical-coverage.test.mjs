import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'

// This QA suite is stacked on PR #1082 and owns only this new test file.
// Prices, products and quantities are synthetic, NOT genuine shop observations.
// Every negative case retains legal IDs, product prices and per-line money totals
// so a superficial schema/cents check cannot accidentally hide the pack defect.
function canonicalTuesday() {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products: m2Products,
  })
  assert.equal(basket.selectedMealCount, 1)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.equal(basket.matchedLineCount, basket.lines.length)
  assert.ok(basket.lines.length >= 3)
  return basket
}

function lineOf(basket, id) {
  const line = basket.lines.find((candidate) => candidate.id === id)
  assert.ok(line, `missing canonical M2 line ${id}`)
  assert.equal(line.status, 'matched')
  return line
}

function changedLine(basket, id, mutate) {
  const matched = lineOf(basket, id)
  const replacement = mutate(structuredClone(matched))
  return {
    ...basket,
    lines: basket.lines.map((line) => line.id === id ? replacement : line),
  }
}

function allChecked(basket) {
  return basket.lines.map((line) => line.id)
}

function assertFailClosed(basket, name) {
  const before = structuredClone(basket)
  const expected = shoppingListCompletion(basket, allChecked(basket))
  assert.equal(
    expected.state,
    'invalid',
    `${name}: a physically untrustworthy basket cannot be called complete: ${JSON.stringify(expected)}`,
  )
  assert.equal(expected.checkedCount, 0, name)
  assert.doesNotMatch(expected.message, /Alle boodschappen afgevinkt\./)
  assert.deepEqual(basket, before, `${name}: input must remain unchanged`)
}

test('positive control: complete canonical active Tuesday basket stays complete and immutable', () => {
  const basket = canonicalTuesday()
  const before = structuredClone(basket)
  const selected = allChecked(basket)

  const complete = shoppingListCompletion(basket, selected)
  assert.equal(complete.state, 'complete')
  assert.equal(complete.checkedCount, selected.length)
  assert.equal(complete.remainingCount, 0)

  const unfinished = shoppingListCompletion(basket, selected.slice(1))
  assert.equal(unfinished.state, 'in-progress')
  assert.equal(unfinished.remainingCount, 1)
  assert.deepEqual(basket, before)
})

test('positive control: physically equivalent g/kg and ml/l packs are not rejected by unit labels alone', () => {
  const source = canonicalTuesday()
  const basmati = lineOf(source, 'basmati-rice')
  const teriyaki = lineOf(source, 'teriyaki-sauce')
  assert.equal(basmati.pack.unit, 'kg')
  assert.equal(teriyaki.pack.unit, 'ml')

  const transformed = {
    ...source,
    lines: source.lines.map((line) => {
      if (line.id === 'basmati-rice') {
        return { ...line, pack: { ...line.pack, amount: line.pack.amount * 1000, unit: 'g' } }
      }
      if (line.id === 'teriyaki-sauce') {
        return { ...line, pack: { ...line.pack, amount: line.pack.amount / 1000, unit: 'l' } }
      }
      return line
    }),
  }
  assert.equal(shoppingListCompletion(transformed, allChecked(transformed)).state, 'complete')
})

test('negative control: marked-complete basket must reject requirements above available pack coverage', async (t) => {
  const source = canonicalTuesday()
  const scenarios = [
    {
      label: 'mass: g demand above a 1 kg pack',
      basket: changedLine(source, 'basmati-rice', (line) => ({
        ...line,
        requirement: { ...line.requirement, amount: 1001 },
      })),
    },
    {
      label: 'volume: ml demand above a 250 ml pack',
      basket: changedLine(source, 'teriyaki-sauce', (line) => ({
        ...line,
        requirement: { ...line.requirement, amount: 251 },
      })),
    },
    {
      label: 'mass: package shrunk to less than requested grams',
      basket: changedLine(source, 'basmati-rice', (line) => ({
        ...line,
        pack: { ...line.pack, amount: 0.05 },
      })),
    },
    {
      label: 'volume: package shrunk to 10 ml without extra packs',
      basket: changedLine(source, 'teriyaki-sauce', (line) => ({
        ...line,
        pack: { ...line.pack, amount: 10 },
      })),
    },
  ]
  for (const { label, basket } of scenarios) {
    await t.test(label, () => assertFailClosed(basket, label))
  }
})

test('negative control: wrong unit families cannot masquerade as a purchased match', async (t) => {
  const source = canonicalTuesday()
  const scenarios = [
    {
      label: 'g demand with l package',
      basket: changedLine(source, 'basmati-rice', (line) => ({
        ...line,
        pack: { ...line.pack, unit: 'l' },
      })),
    },
    {
      label: 'ml demand with kg package',
      basket: changedLine(source, 'teriyaki-sauce', (line) => ({
        ...line,
        pack: { ...line.pack, unit: 'kg' },
      })),
    },
    {
      label: 'gram demand with piece package',
      basket: changedLine(source, 'basmati-rice', (line) => ({
        ...line,
        pack: { ...line.pack, unit: 'piece' },
      })),
    },
  ]
  for (const { label, basket } of scenarios) {
    await t.test(label, () => assertFailClosed(basket, label))
  }
})

test('negative control: forged extra packs with consistent money still cannot be canonical demand', () => {
  const source = canonicalTuesday()
  const original = lineOf(source, 'basmati-rice')
  const forged = changedLine(source, 'basmati-rice', (line) => ({
    ...line,
    packs: line.packs + 1,
    lineTotalCents: (line.packs + 1) * line.pricePerPackCents,
  }))
  forged.totalCents += original.pricePerPackCents
  assert.ok(forged.totalCents > source.totalCents)
  assertFailClosed(forged, 'pack count forged above actual required count')
})

test('negative control: current checked item can never bless mismatched basket money total', () => {
  const source = canonicalTuesday()
  const forged = { ...source, totalCents: source.totalCents + 1 }
  assertFailClosed(forged, 'basket total differs from sum of matched lines')
})
