import assert from 'node:assert/strict'
import test from 'node:test'

import {
  previewPlanRecipeSwap,
  acceptPlanRecipeSwap,
} from '../src/domain/planRecipeSwapPreview.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

// Independent M3/M2 bridge QA: synthetic catalog values are not real prices.
const activeDays = ['Di', 'Wo']
const scenario = {
  store: m2Store,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays,
  products: m2Products,
  day: 'Di',
  replacementRecipeId: 'pasta',
}

function copyProducts() {
  return m2Products.map((product) => ({ ...product }))
}

test('independent QA: reordering only the live catalog and active days preserves a deliberate recipe confirmation', () => {
  const preview = previewPlanRecipeSwap(scenario)
  assert.equal(preview.status, 'ready')
  const frozen = JSON.stringify({ preview, plan: m2InitialPlan, products: m2Products })
  const result = acceptPlanRecipeSwap(
    preview, m2InitialPlan, [...activeDays].reverse(),
    { ...m2Store }, [...copyProducts()].reverse(),
  )
  assert.equal(result.status, 'applied')
  assert.equal(result.plan.find((meal) => meal.day === 'Di').recipeId, 'pasta')
  assert.equal(JSON.stringify({ preview, plan: m2InitialPlan, products: m2Products }), frozen)
  assert.notEqual(result.plan, m2InitialPlan)
})

test('independent QA: every monetarily/materially relevant catalog drift revokes an earlier recipe confirmation', () => {
  const preview = previewPlanRecipeSwap(scenario)
  assert.equal(preview.status, 'ready')
  const productId = m2Products.find((product) => product.id === 'spaghetti-500')?.id
  assert.ok(productId)
  const updates = [
    ['price', (p) => ({ ...p, priceCents: p.priceCents + 1 })],
    ['pack size', (p) => ({ ...p, packAmount: p.packAmount + 1 })],
    ['pack unit', (p) => ({ ...p, packUnit: 'piece' })],
    ['availability', (p) => ({ ...p, available: !p.available })],
    ['product name', (p) => ({ ...p, name: p.name + ' fictief' })],
    ['retailer identity', (p) => ({ ...p, storeId: 'synthetic-other-store' })],
    ['product identity', (p) => ({ ...p, id: p.id + '-altered' })],
  ]
  const frozen = JSON.stringify({ preview, products: m2Products, plan: m2InitialPlan })
  for (const [label, update] of updates) {
    const changedProducts = copyProducts().map((p) => p.id === productId ? update(p) : p)
    const result = acceptPlanRecipeSwap(preview, m2InitialPlan, activeDays, m2Store, changedProducts)
    assert.equal(result.status, 'stale', label)
    assert.equal(result.plan, null, label)
  }
  const withInsertedProduct = [...copyProducts(), {
    id: 'qa-fictional-extra-product', storeId: m2Store.id,
    name: 'Extra fictief product', packAmount: 1, packUnit: 'piece',
    priceCents: 10, available: true,
  }]
  assert.equal(
    acceptPlanRecipeSwap(preview, m2InitialPlan, activeDays, m2Store, withInsertedProduct).status,
    'stale',
  )
  assert.equal(JSON.stringify({ preview, products: m2Products, plan: m2InitialPlan }), frozen)
})

test('independent QA: current store identity/name and any changed live recipe assignment require a new preview', () => {
  const preview = previewPlanRecipeSwap(scenario)
  assert.equal(preview.status, 'ready')
  for (const store of [
    { ...m2Store, id: m2Store.id + '-new' },
    { ...m2Store, name: m2Store.name + ' fictional' },
  ]) {
    assert.equal(acceptPlanRecipeSwap(preview, m2InitialPlan, activeDays, store, m2Products).status, 'stale')
  }
  const changedPlan = m2InitialPlan.map((m) => m.day === 'Wo' ? { ...m, recipeId: 'tikka' } : m)
  assert.equal(acceptPlanRecipeSwap(preview, changedPlan, activeDays, m2Store, m2Products).status, 'stale')
})

test('independent QA: unresolved fictional price cannot become savings but intentional recipe change is still reversible', () => {
  const incomplete = m2Products.filter((p) => p.id !== 'spaghetti-500')
  const preview = previewPlanRecipeSwap({ ...scenario, products: incomplete })
  assert.equal(preview.status, 'unknown')
  assert.equal(preview.deltaCents, null)
  const result = acceptPlanRecipeSwap(preview, m2InitialPlan, activeDays, m2Store, incomplete)
  assert.equal(result.status, 'applied')
  assert.equal(result.plan.find((meal) => meal.day === 'Di').recipeId, 'pasta')
  assert.equal(m2InitialPlan.find((meal) => meal.day === 'Di').recipeId, 'teriyaki')
})
