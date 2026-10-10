import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import { m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Fully synthetic M2 test groceries. These are not real retailer observations.
const baselineStore = { id: 'qa-stale-baseline', name: 'Controlled A' }
const candidateStore = { id: 'qa-stale-candidate', name: 'Controlled B' }

function basket(store, adjustment = 0) {
  const products = m2Products.map((product) => ({
    ...product,
    id: `${store.id}:${product.id}`,
    storeId: store.id,
    priceCents: product.priceCents + adjustment,
  }))
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products,
  })
}

function comparisonSnapshot() {
  const baseline = basket(baselineStore)
  const candidate = basket(candidateStore, 1)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true, comparison.reasons.join('; '))
  assert.equal(comparisonNextStep({ baseline, candidate, comparison }).canShowDifference, true)
  return { baseline, candidate, comparison }
}

function changedMatchedLine(input, key, change) {
  const line = input.candidate.lines.find((row) => row.status === 'matched' && row.id === key)
  assert.ok(line, `missing matched row: ${key}`)
  return {
    ...input,
    candidate: {
      ...input.candidate,
      lines: input.candidate.lines.map((row) =>
        row.id === key ? change(structuredClone(line)) : row),
    },
  }
}

test('positive: recomputed complete snapshots allow only the same-demand controlled difference', () => {
  const source = comparisonSnapshot()
  const before = structuredClone(source)
  assert.equal(comparisonNextStep(source).code, 'comparison-ready')
  const newComparison = compareFullBaskets({ baseline: source.baseline, candidate: source.candidate })
  assert.deepEqual(newComparison, source.comparison)
  assert.deepEqual(source, before)
})

test('negative: old claimable comparator must not authorize changed current requirement amounts', async (t) => {
  const source = comparisonSnapshot()
  const id = source.candidate.lines.find((line) => line.status === 'matched').id
  for (const change of [0.1, 1, 100]) {
    await t.test(`demand drift +${change}`, () => {
      const changed = changedMatchedLine(source, id, (line) => ({
        ...line,
        requirement: { ...line.requirement, amount: line.requirement.amount + change },
      }))
      const snapshot = structuredClone(changed)
      assert.equal(compareFullBaskets({ baseline: changed.baseline, candidate: changed.candidate }).claimable, false)
      const advice = comparisonNextStep(changed)
      assert.equal(advice.canShowDifference, false, 'stale claimable snapshot must not open money UI')
      assert.notEqual(advice.code, 'comparison-ready')
      assert.deepEqual(changed, snapshot)
    })
  }
})

test('negative: a stale amount unit must not preserve a previous comparison claim', () => {
  const source = comparisonSnapshot()
  const id = source.candidate.lines.find((line) => line.status === 'matched' && line.requirement.unit === 'g')?.id
  assert.ok(id, 'Tuesday fixture must contain a mass requirement')
  const changed = changedMatchedLine(source, id, (line) => ({
    ...line,
    requirement: { ...line.requirement, unit: 'kg' },
  }))
  assert.equal(compareFullBaskets({ baseline: changed.baseline, candidate: changed.candidate }).claimable, false)
  assert.equal(comparisonNextStep(changed).canShowDifference, false)
})

test('negative: physically impossible packs must invalidate stale comparison guidance', async (t) => {
  const source = comparisonSnapshot()
  const matched = source.candidate.lines.find((line) => line.status === 'matched' && line.requirement.unit === 'g')
  assert.ok(matched)
  const scenarios = [
    ['incompatible pack family', (line) => ({ ...line, pack: { ...line.pack, unit: 'l' } })],
    ['zero actual package content', (line) => ({ ...line, pack: { ...line.pack, amount: 0 } })],
    ['forged extra purchased packs', (line) => ({ ...line, packs: line.packs + 1 })],
  ]
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const changed = changedMatchedLine(source, matched.id, mutate)
      const actual = compareFullBaskets({ baseline: changed.baseline, candidate: changed.candidate })
      assert.equal(actual.claimable, false)
      assert.equal(comparisonNextStep(changed).canShowDifference, false)
    })
  }
})
