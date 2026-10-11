import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { m3BaselineProducts, m3BaselineStore } from '../src/data/m3ComparisonFixture.ts'
import { basketCostDisclosure } from '../src/features/basket/basketPresentation.ts'

function sourceBasket(products = m3BaselineProducts, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m3BaselineStore, products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays,
  })
}
const disclose = (basket) =>
  basketCostDisclosure(basket.totalCents, basket.unresolvedLineCount, basket)

test('postrepair: complete, partial and empty controlled M2-planned baskets keep honest price states', () => {
  const full = sourceBasket()
  assert.equal(full.unresolvedLineCount, 0)
  assert.equal(disclose(full).state, 'complete')
  assert.notEqual(disclose(full).amountLabel, '—')

  const unresolved = sourceBasket([])
  assert.ok(unresolved.unresolvedLineCount > 0)
  assert.equal(disclose(unresolved).state, 'minimum')
  assert.match(disclose(unresolved).amountLabel, /^min\./)

  const empty = sourceBasket(m3BaselineProducts, [])
  assert.equal(empty.lines.length, 0)
  assert.equal(disclose(empty).state, 'complete')
  assert.match(disclose(empty).amountLabel, /0,00/)
})

test('postrepair: exact disclosed amount and unresolved count are tied to passed basket snapshot', () => {
  const basket = sourceBasket()
  assert.equal(basketCostDisclosure(basket.totalCents + 1, basket.unresolvedLineCount, basket).state, 'unknown')
  assert.equal(basketCostDisclosure(basket.totalCents, basket.unresolvedLineCount + 1, basket).state, 'unknown')
  assert.equal(basketCostDisclosure(basket.totalCents, basket.unresolvedLineCount, null).state, 'unknown')

  // Intentional backwards-compatible pure formatting path is unaffected.
  assert.equal(basketCostDisclosure(basket.totalCents, basket.unresolvedLineCount).state, 'complete')
})

test('postrepair: extra corruptions refuse a visually convincing basket total', async (t) => {
  const base = sourceBasket()
  const changes = [
    ['matched line pack family changed', (b) => {
      b.lines.find((x) => x.status === 'matched').pack.unit = 'ml'
    }],
    ['nonfinite pack quantity', (b) => {
      b.lines.find((x) => x.status === 'matched').pack.amount = Infinity
    }],
    ['noncanonical row identity', (b) => {
      b.lines.find((x) => x.status === 'matched').id += ' '
    }],
    ['untrusted matching confidence', (b) => {
      b.lines.find((x) => x.status === 'matched').matchScore = 0
    }],
    ['missing product identity', (b) => {
      b.lines.find((x) => x.status === 'matched').productId = ''
    }],
    ['invalid matched price', (b) => {
      b.lines.find((x) => x.status === 'matched').pricePerPackCents = Number.NaN
    }],
    ['inconsistent basket selected meal counter', (b) => {
      b.selectedMealCount = -1
    }],
    ['no canonical line collection', (b) => {
      b.lines = null
    }],
  ]

  for (const [description, mutate] of changes) {
    await t.test(description, () => {
      const basket = structuredClone(base)
      mutate(basket)
      assert.equal(disclose(basket).state, 'unknown')
      assert.equal(disclose(basket).amountLabel, '—')
    })
  }
})

test('postrepair: each BasketView money panel binds its exact visible basket', async () => {
  const src = await readFile(new URL('../src/features/basket/BasketView.tsx', import.meta.url), 'utf8')
  for (const name of ['basket', 'comparisonBaseline', 'comparisonCandidate']) {
    const pattern = new RegExp('basketCostDisclosure\\(\\s*' + name +
      '\\.totalCents,\\s*' + name + '\\.unresolvedLineCount,\\s*' + name + ',?\\s*\\)')
    assert.match(src, pattern)
  }
})
