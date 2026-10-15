import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

// Synthetic M2 fixtures only. Nothing here is a real retailer observation,
// a live-price quotation, or evidence of customer savings.
function build({ store = m2Store, activeDays = ['Di'], products = m2Products } = {}) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

function reprice(products, id, priceCents) {
  return products.map((product) =>
    product.id === id ? { ...product, priceCents } : { ...product },
  )
}

function matchedLines(basket) {
  return basket.lines.filter((line) => line.status === 'matched')
}

function traceShape(basket) {
  return basket.lines.map((line) =>
    line.status === 'matched'
      ? {
          id: line.id,
          status: line.status,
          productId: line.productId,
          productName: line.productName,
          packs: line.packs,
          pack: line.pack,
          requirement: line.requirement,
          matchScore: line.matchScore,
        }
      : {
          id: line.id,
          status: line.status,
          requirement: line.requirement,
          reasons: line.reasons,
        },
  )
}

test('product-core: repricing an accepted pack changes exact basket cents by packs × cent delta', () => {
  const activeWeeks = [
    [],
    ['Ma'],
    ['Di'],
    ['Wo'],
    ['Ma', 'Do'],
    ['Ma', 'Di', 'Wo', 'Do'],
  ]
  const newPrices = [0, 1, 10, 99, 101, 999, 5999]

  let checked = 0
  for (const activeDays of activeWeeks) {
    const original = build({ activeDays })
    for (const product of m2Products) {
      const originalLine = matchedLines(original).find(
        (line) => line.productId === product.id,
      )
      for (const priceCents of newPrices) {
        const changedProducts = reprice(m2Products, product.id, priceCents)
        const changed = build({ activeDays, products: changedProducts })

        // Matching policy and required package counts do not depend on price.
        assert.deepEqual(traceShape(changed), traceShape(original))
        assert.equal(changed.selectedMealCount, original.selectedMealCount)
        assert.equal(changed.matchedLineCount, original.matchedLineCount)
        assert.equal(changed.unresolvedLineCount, original.unresolvedLineCount)

        const selectedPacks = originalLine?.packs ?? 0
        const expectedTotal =
          original.totalCents +
          selectedPacks * (priceCents - product.priceCents)
        assert.equal(
          changed.totalCents,
          expectedTotal,
          `price sensitivity: ${activeDays.join(',')} / ${product.id} / ${priceCents}`,
        )
        assert.equal(
          matchedLines(changed).reduce((sum, line) => sum + line.lineTotalCents, 0),
          expectedTotal,
        )

        if (originalLine) {
          const changedLine = matchedLines(changed).find(
            (line) => line.productId === product.id,
          )
          assert.equal(changedLine.pricePerPackCents, priceCents)
          assert.equal(changedLine.lineTotalCents, selectedPacks * priceCents)
        }
        checked += 1
      }
    }
  }
  assert.equal(checked, activeWeeks.length * m2Products.length * newPrices.length)
})

test('product-core: complete synthetic full-basket comparison preserves price delta and direction', () => {
  const activeDays = ['Di'] // Four resolved ingredients in the controlled fixture.
  const baseline = build({ activeDays })
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.ok(baseline.lines.length > 0)

  const candidateStore = {
    id: 'comparison-price-sensitivity-fixture',
    name: 'Tweede voorbeeldwinkel · uitsluitend testdata',
  }
  const candidateCatalog = m2Products.map((product) => ({
    ...product,
    storeId: candidateStore.id,
  }))
  const unchanged = build({
    store: candidateStore,
    activeDays,
    products: candidateCatalog,
  })
  const same = compareFullBaskets({ baseline, candidate: unchanged })
  assert.equal(same.claimable, true)
  assert.equal(same.outcome, 'same')
  assert.equal(same.deltaCents, 0)
  assert.equal(same.savingsCents, 0)

  // Prices change, not planned demand or selected products. Keep a complete
  // same-demand comparison while verifying both signs of the integer-cent delta.
  const pricedProduct = m2Products.find((p) => p.id === 'basmati-1kg')
  assert.ok(pricedProduct)
  const baselineLine = matchedLines(baseline).find(
    (line) => line.productId === pricedProduct.id,
  )
  assert.ok(baselineLine)
  for (const priceChange of [-100, -1, 0, 1, 100, 1500]) {
    const candidate = build({
      store: candidateStore,
      activeDays,
      products: reprice(
        candidateCatalog,
        pricedProduct.id,
        pricedProduct.priceCents + priceChange,
      ),
    })
    const comparison = compareFullBaskets({ baseline, candidate })
    const expectedDelta = baselineLine.packs * priceChange
    assert.equal(comparison.claimable, true)
    assert.deepEqual(comparison.reasons, [])
    assert.equal(comparison.deltaCents, expectedDelta)
    assert.equal(comparison.savingsCents, -expectedDelta || 0)
    assert.equal(
      comparison.outcome,
      expectedDelta < 0 ? 'better' : expectedDelta > 0 ? 'worse' : 'same',
    )
    assert.equal(
      comparison.lineDeltas.reduce((sum, line) => sum + line.deltaCents, 0),
      expectedDelta,
    )
    assert.equal(candidate.totalCents - baseline.totalCents, expectedDelta)
    assert.deepEqual(
      comparison.lineDeltas.map((line) => line.id).sort(),
      matchedLines(baseline).map((line) => line.id).sort(),
    )
  }
})

test('product-core: unknown and empty demand never become apparent savings after repricing', () => {
  const candidateStore = {
    id: 'comparison-price-unknown-fixture',
    name: 'Tweede voorbeeldwinkel · uitsluitend testdata',
  }
  const candidateProducts = m2Products.map((product) => ({
    ...product,
    storeId: candidateStore.id,
  }))

  // No selected days means no purchased packs, independently of any fixture
  // price variation. Comparison claimability for empty weeks is separately
  // tracked in issue #1051, which is owned by comparator PR #1012.
  for (const changedPrice of [0, 1, 99999]) {
    const empty = build({ activeDays: [] })
    const repriced = build({
      store: candidateStore,
      activeDays: [],
      products: reprice(candidateProducts, 'basmati-1kg', changedPrice),
    })
    assert.deepEqual(empty.lines, [])
    assert.deepEqual(repriced.lines, [])
    assert.equal(empty.totalCents, 0)
    assert.equal(repriced.totalCents, 0)
  }

  // A partially unresolved week must retain unknown money claims even when
  // the valid, matched portion becomes cheaper.
  const baseline = build({ activeDays: ['Ma'] })
  assert.ok(baseline.unresolvedLineCount > 0)
  for (const priceCents of [0, 1, 900]) {
    const candidate = build({
      store: candidateStore,
      activeDays: ['Ma'],
      products: reprice(candidateProducts, 'chicken-400', priceCents),
    })
    const compared = compareFullBaskets({ baseline, candidate })
    assert.equal(compared.outcome, 'unknown')
    assert.equal(compared.claimable, false)
    assert.equal(compared.deltaCents, null)
    assert.equal(compared.savingsCents, null)
    assert.deepEqual(compared.lineDeltas, [])
  }
})
