import assert from 'node:assert/strict'
import test from 'node:test'
import { m2InitialPlan, m2Recipes, m2DefaultActiveDays } from '../src/data/m2Fixture.ts'
import { buildDynamicReviewedWeek } from '../src/domain/reviewedCatalogPlannedWeek.ts'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { buildPersistedReviewedWeek } from '../scripts/retailer-private-sqlite-planner-review.mjs'
import {
  selectedFixtureWeek,
  main as reviewedWeekCommand,
} from '../scripts/retailer-reviewed-custom-week.mjs'

test('controlled recipe swaps preserve canonical default, stable order and frozen fixtures', () => {
  const original = structuredClone(m2InitialPlan)
  const defaultWeek = selectedFixtureWeek([])
  assert.deepEqual(defaultWeek.days, m2DefaultActiveDays)
  assert.deepEqual(defaultWeek.plan, m2InitialPlan)
  assert.notStrictEqual(defaultWeek.plan, m2InitialPlan)
  assert.notStrictEqual(defaultWeek.plan[0], m2InitialPlan[0])
  assert.deepEqual(selectedFixtureWeek(['--days', 'Do,Ma']).days, ['Ma', 'Do'])

  const changed = selectedFixtureWeek(['--plan', 'Do:pasta,Ma:teriyaki'])
  assert.deepEqual(changed.days, ['Ma', 'Do'])
  assert.deepEqual(changed.plan, [
    { day: 'Ma', recipeId: 'teriyaki' },
    { day: 'Di', recipeId: 'teriyaki' },
    { day: 'Wo', recipeId: 'pasta' },
    { day: 'Do', recipeId: 'pasta' },
  ])
  changed.plan[0].recipeId = 'tikka'
  assert.deepEqual(m2InitialPlan, original)
  assert.ok(Object.isFrozen(m2Recipes))
  assert.ok(Object.isFrozen(m2InitialPlan))
})

test('only finite approved day/recipe choices are accepted before private source loading', () => {
  const invalid = [
    ['--plan'], ['--plan', ''], ['--plan', 'Ma:unknown'],
    ['--plan', 'Vr:tikka'], ['--plan', 'Ma:pasta,Ma:teriyaki'],
    ['--plan', 'Ma:pasta,Do:pasta,Ma:tikka'],
    ['--plan', 'Ma:pasta, Do:teriyaki'],
    ['--plan', 'Ma:pasta,' ], ['--plan', ',Ma:pasta'],
    ['--plan', 'Ma:pasta:extra'], ['--plan', 'Ma:Pasta'],
    ['--plan', 'Ma:__proto__'], ['--plan', 'Ma:tikka\nDo:pasta'],
    ['--plan', 'Ma:tikka,Di:pasta,Wo:pasta,Do:teriyaki,Ma:tikka'],
    ['--days', 'Ma,Ma'], ['--days', 'Vr'],
    ['--days', 'Ma, Do'], ['--days', 'Ma:tikka'],
    ['--recipes', 'Ma:pasta'], ['--plan', 'Ma:pasta', '--days', 'Do'],
    ['--plan', 4], [null, 'Ma:pasta'], 'not-an-array',
  ]
  for (const args of invalid) {
    assert.throws(() => selectedFixtureWeek(args), undefined, JSON.stringify(args))
  }
})

test('two controlled pasta nights aggregate one physical demand without authorizing prices', async () => {
  const catalog = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
  const week = selectedFixtureWeek(['--plan', 'Do:pasta,Ma:pasta'])
  const result = buildDynamicReviewedWeek({
    catalog, plan: week.plan, recipes: m2Recipes, activeDays: week.days,
  })
  assert.equal(result.activeDayCount, 2)
  assert.equal(result.selectedMealCount, 2)
  assert.equal(result.uniqueIngredientNeeds, 3)
  assert.equal(result.retailerReviewRows, 6)
  for (const [id, amount, unit] of [
    ['spaghetti', 500, 'g'],
    ['tomato-cubes', 800, 'g'],
    ['greek-yogurt', 200, 'g'],
  ]) {
    const rows = result.preview.rows.filter(row => row.ingredientId === id)
    assert.equal(rows.length, 2)
    assert.ok(rows.every(row => row.required.amount === amount && row.required.unit === unit))
  }
  assert.equal(result.livePriceClaimsAllowed, false)
  assert.equal(result.preview.publicSavingsClaimEligible, false)
  assert.equal(result.preview.productionEnabled, false)
})

test('private CLI recipe swaps affect queue totals without leaking SKU, money or source data', async () => {
  const output = []
  const twoPasta = await reviewedWeekCommand(['--plan', 'Ma:pasta,Do:pasta'], text => output.push(text))
  assert.deepEqual([twoPasta.activeDays, twoPasta.selectedMeals,
    twoPasta.uniqueIngredientNeeds, twoPasta.retailerReviewRows], [2, 2, 3, 6])
  assert.deepEqual(JSON.parse(output.join('')), twoPasta)
  assert.equal(twoPasta.externalRequests, 0)
  assert.equal(twoPasta.livePricesAvailable, false)
  assert.equal(twoPasta.publicSavingsClaimEligible, false)
  assert.doesNotMatch(output.join(''), /https?:|priceCents|sourceUrl|capturedAt|productName|retailerProductId|ingredientId|participantKey|€|savingsCents/i)
  const originalWeek = await reviewedWeekCommand(['--days', 'Ma,Do'], () => {})
  assert.deepEqual([originalWeek.uniqueIngredientNeeds, originalWeek.retailerReviewRows], [5, 10])
  const mix = await reviewedWeekCommand(['--plan', 'Ma:tikka,Do:teriyaki'], () => {})
  assert.deepEqual([mix.uniqueIngredientNeeds, mix.retailerReviewRows], [8, 16])
})

test('persisted private SQLite follows the exact same swapped recipe demand as memory preview', async () => {
  const persisted = await buildPersistedReviewedWeek(['--plan', 'Do:pasta,Ma:pasta'])
  assert.equal(persisted.mode, 'persisted-private-sqlite-to-dynamic-planner-review')
  assert.deepEqual([
    persisted.sourceSnapshots, persisted.selectedMealDays,
    persisted.ingredientNeeds, persisted.retailerReviewRows,
  ], [6, 2, 3, 6])
  assert.equal(persisted.productionEnabled, false)
  assert.equal(persisted.publicSavingsClaimEligible, false)
  assert.equal(persisted.livePricesAvailable, false)
  assert.equal(persisted.externalRequests, 0)
  const oldChoice = await buildPersistedReviewedWeek(['--days', 'Ma,Do'])
  assert.deepEqual([
    oldChoice.selectedMealDays, oldChoice.ingredientNeeds, oldChoice.retailerReviewRows,
  ], [2, 5, 10])
  // Wrong recipes fail before the temp SQLite file or Python subprocess can run.
  await assert.rejects(buildPersistedReviewedWeek(['--plan', 'Ma:unlicensed']))
})
