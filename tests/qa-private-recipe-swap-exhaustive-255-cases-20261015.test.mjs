import assert from 'node:assert/strict'
import test from 'node:test'
import { m2DefaultActiveDays, m2Recipes, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { buildDynamicReviewedWeek } from '../src/domain/reviewedCatalogPlannedWeek.ts'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { selectedFixtureWeek, main as memoryCli } from '../scripts/retailer-reviewed-custom-week.mjs'
import { buildPersistedReviewedWeek } from '../scripts/retailer-private-sqlite-planner-review.mjs'

// Separate QA worker: all 255 nonempty day-subset × approved recipe assignments.
// This is an independent ingredient-unit arithmetic oracle over immutable M2
// recipes and the actual six archived reviewed PLUS/Deka adapter snapshots.
// No synthetic retailer prices, network requests, permission or savings claims.
const recipeIds = m2Recipes.map(recipe => recipe.id)
const expectedNames = [...m2DefaultActiveDays]
const frozenPlan = structuredClone(m2InitialPlan)
const recipeById = new Map(m2Recipes.map(recipe => [recipe.id, recipe]))

function expectedPhysicalDemand(ids) {
  const count = new Map()
  for (const id of ids) {
    const recipe = recipeById.get(id)
    assert.ok(recipe, 'selection is from the frozen approved M2 allowlist')
    for (const item of recipe.ingredients) {
      const old = count.get(item.id)
      if (old) assert.equal(old.unit, item.unit, 'same ingredient must retain physical unit')
      count.set(item.id, { amount: (old?.amount ?? 0) + item.amount, unit: item.unit })
    }
  }
  return count
}

function cases() {
  const result = []
  for (let mask = 1; mask < (1 << expectedNames.length); mask++) {
    const days = expectedNames.filter((_, index) => mask & (1 << index))
    const combinations = recipeIds.length ** days.length
    for (let n = 0; n < combinations; n++) {
      let cursor = n
      const selections = []
      for (const day of days) {
        selections.push([day, recipeIds[cursor % recipeIds.length]])
        cursor = Math.floor(cursor / recipeIds.length)
      }
      result.push(selections)
    }
  }
  return result
}

test('independent exhaustive 255-case oracle: any approved planned-day recipe assignment preserves physical counts and no claim', async () => {
  const archived = await loadReviewedRepositoryFixtures()
  assert.equal(archived.summary.sources, 6)
  assert.equal(archived.summary.rejectedSources, 0)
  assert.equal(archived.summary.permissionVerified, false)
  const catalog = buildUniversalRetailerCatalog(archived)
  const all = cases()
  assert.equal(all.length, 255)
  for (const choice of all) {
    const spec = choice.map(([day, recipe]) => day + ':' + recipe).join(',')
    const reversed = choice.toReversed().map(([day, recipe]) => day + ':' + recipe).join(',')
    const picked = selectedFixtureWeek(['--plan', spec])
    const reordered = selectedFixtureWeek(['--plan', reversed])
    assert.deepEqual(picked, reordered, 'entry ordering cannot alter physical demand')
    assert.deepEqual(picked.days, choice.map(([day]) => day))
    const wanted = expectedPhysicalDemand(choice.map(([, recipe]) => recipe))
    const week = buildDynamicReviewedWeek({
      catalog, plan: picked.plan, recipes: m2Recipes, activeDays: picked.days,
    })
    assert.equal(week.activeDayCount, choice.length, spec)
    assert.equal(week.selectedMealCount, choice.length, spec)
    assert.equal(week.uniqueIngredientNeeds, wanted.size, spec)
    assert.equal(week.retailerReviewRows, 2 * wanted.size, spec)
    assert.equal(week.livePriceClaimsAllowed, false)
    assert.equal(week.preview.productionEnabled, false)
    assert.equal(week.preview.publicSavingsClaimEligible, false)
    assert.equal(week.preview.rows.length, 2 * wanted.size)
    for (const [id, requirement] of wanted) {
      const rows = week.preview.rows.filter(row => row.ingredientId === id)
      assert.equal(rows.length, 2, 'one private review candidate row per store')
      for (const row of rows) {
        assert.equal(row.required.amount, requirement.amount, spec + ' ' + id)
        assert.equal(row.required.unit, requirement.unit, spec + ' ' + id)
      }
    }
  }
  assert.deepEqual(m2InitialPlan, frozenPlan, 'no mutation of global recipe defaults')
})

test('three representative extreme/subset recipes agree across real memory + private persisted SQLite pipelines', async () => {
  for (const spec of [
    'Ma:tikka',
    'Do:pasta,Ma:pasta',
    'Ma:pasta,Di:teriyaki,Wo:tikka,Do:pasta',
  ]) {
    const output = []
    const memory = await memoryCli(['--plan', spec], t => output.push(t))
    const persisted = await buildPersistedReviewedWeek(['--plan', spec])
    assert.deepEqual(JSON.parse(output.join('')), memory)
    assert.equal(memory.activeDays, persisted.selectedMealDays)
    assert.equal(memory.uniqueIngredientNeeds, persisted.ingredientNeeds)
    assert.equal(memory.retailerReviewRows, persisted.retailerReviewRows)
    assert.equal(memory.unresolved, persisted.unresolved)
    assert.equal(memory.proposedForManualReview, persisted.proposedForManualReview)
    assert.equal(persisted.sourceSnapshots, 6)
    assert.equal(memory.livePricesAvailable, false)
    assert.equal(persisted.livePricesAvailable, false)
    assert.equal(memory.publicSavingsClaimEligible, false)
    assert.equal(persisted.publicSavingsClaimEligible, false)
    assert.equal(memory.externalRequests, 0)
    assert.equal(persisted.externalRequests, 0)
    assert.doesNotMatch(output.join(''), /https?:|sourceUrl|productName|priceCents|capturedAt|participant|savingsCents|€|sha256/i)
  }
})
