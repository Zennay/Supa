import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildCivilClockCheckedPrivatePlannedWeek,
} from '../scripts/retailer-private-civil-week-bridge.mjs'

// Independent QA1 acceptance for product-core #3712, frozen at ee2ba1a.
// Read only the six repository-pinned sanitized historical PLUS/Deka archives.
// No network, live grocery quotes, source-rights grant, public savings or VPS.
async function historicalSix() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}

function assertPrivate(summary, review, expectedNeeds) {
  assert.equal(summary.reviewedArchivedSources, 6)
  assert.equal(summary.ingredientNeeds, expectedNeeds)
  assert.equal(summary.retailerReviewRows, expectedNeeds * 2)
  assert.equal(review.preview.rows.length, expectedNeeds * 2)
  assert.equal(summary.requiresCurrentHumanObservation, true)
  assert.equal(summary.sourcePermissionVerified, false)
  assert.equal(summary.productionReady, false)
  assert.equal(summary.livePricesAvailable, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.externalRequests, 0)
  assert.equal(review.livePriceClaimsAllowed, false)
  assert.equal(review.preview.productionEnabled, false)
  assert.equal(review.preview.completeFieldEvidence, false)
  assert.equal(review.preview.needsHumanSourceReview, true)
  for (const retailer of ['plus', 'dekamarkt']) {
    const own = review.preview.rows.filter(row => row.retailerId === retailer)
    assert.equal(own.length, expectedNeeds)
    assert.equal(new Set(own.map(row => row.ingredientId)).size, expectedNeeds)
    assert.equal(
      own.filter(row => row.status === 'suggested-for-manual-review').length,
      summary.perRetailer[retailer].suggestedForManualReview)
    assert.equal(
      own.filter(row => row.status === 'unresolved').length,
      summary.perRetailer[retailer].unresolved)
  }
  assert.doesNotMatch(JSON.stringify(summary),
    /sourceUrl|capturedAt|snapshotSha256|priceCents|currentPrice|estimatedSavings|https:\/\//i)
  assert.doesNotMatch(JSON.stringify(review.preview),
    /priceCents|estimatedSavings|publicSavingsClaimEligible":true/i)
}

function byStoreAndIngredient(result, id) {
  const rows = result.privateReview.preview.rows.filter(row => row.ingredientId === id)
  assert.equal(rows.length, 2, 'both supermarkets must review the same real need')
  assert.deepEqual(rows.map(row => row.retailerId), ['plus', 'dekamarkt'])
  return rows
}

test('selected real Ma+Di+Do ingredients preserve exact cross-store demand and source-denied flags', async () => {
  const records = await historicalSix()
  const before = structuredClone(records)
  const result = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Di', 'Do'],
    { plan: structuredClone(m2InitialPlan), recipes: structuredClone(m2Recipes) },
  )
  assert.equal(result.summary.selectedPlanSource, 'custom-private')
  assert.equal(result.summary.activeDays, 3)
  assert.equal(result.privateReview.selectedMealCount, 3)
  assertPrivate(result.summary, result.privateReview, 8)
  for (const row of byStoreAndIngredient(result, 'chicken-thigh')) {
    assert.deepEqual(row.required, { amount: 600, unit: 'g' })
  }
  for (const row of byStoreAndIngredient(result, 'basmati-rice')) {
    assert.deepEqual(row.required, { amount: 450, unit: 'g' })
  }
  for (const row of byStoreAndIngredient(result, 'edamame')) {
    assert.deepEqual(row.required, { amount: 150, unit: 'g' })
  }
  assert.deepEqual(records, before, 'catalog/planner must not mutate source captures')
})

test('planner/day permutation cannot change historical two-store review or aggregate counters', async () => {
  const records = await historicalSix()
  const recipes = structuredClone(m2Recipes)
  const plan = structuredClone(m2InitialPlan)
  const first = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Di', 'Do'], { plan, recipes },
  )
  const reversed = buildCivilClockCheckedPrivatePlannedWeek(
    [...records].reverse(), ['Do', 'Di', 'Ma'],
    { plan: [...plan].reverse(), recipes: [...recipes].reverse() },
  )
  assert.deepEqual(reversed.summary, first.summary)
  assert.deepEqual(reversed.privateReview, first.privateReview,
    'input ordering must not invent, drop or reorder a private shopping requirement')
  assertPrivate(reversed.summary, reversed.privateReview, 8)
})

test('only a changed real recipe quantity changes both store needs; unselected meals are inert', async () => {
  const records = await historicalSix()
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  const original = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Do'], { plan, recipes },
  )
  const unselectedChanged = structuredClone(plan)
  unselectedChanged.find(meal => meal.day === 'Wo').recipeId = 'teriyaki'
  const unaffected = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Do'], { plan: unselectedChanged, recipes },
  )
  assert.deepEqual(unaffected.privateReview, original.privateReview)
  assert.deepEqual(unaffected.summary, original.summary)

  const scaledRecipes = structuredClone(recipes)
  scaledRecipes.find(recipe => recipe.id === 'tikka').ingredients
    .find(item => item.id === 'chicken-thigh').amount = 400
  const changed = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Do'], { plan, recipes: scaledRecipes },
  )
  assertPrivate(changed.summary, changed.privateReview, 5)
  for (const row of byStoreAndIngredient(changed, 'chicken-thigh')) {
    assert.deepEqual(row.required, { amount: 800, unit: 'g' })
  }
  for (const row of byStoreAndIngredient(changed, 'basmati-rice')) {
    assert.deepEqual(row.required, { amount: 300, unit: 'g' })
  }
  assert.equal(original.privateReview.preview.rows.length, changed.privateReview.preview.rows.length)
  assert.equal(recipes[0].ingredients[0].amount, 300, 'input copy must remain unchanged')
})

test('partial custom plans must never silently claim a selected unplanned day was reviewed', async () => {
  const records = await historicalSix()
  const recipes = structuredClone(m2Recipes)
  const mondayOnly = structuredClone(m2InitialPlan).filter(meal => meal.day === 'Ma')
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Do'], { plan: mondayOnly, recipes },
  ), /Missing planned meal/)
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Vr'], { plan: structuredClone(m2InitialPlan), recipes },
  ), /Missing planned meal/)
  const valid = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma'], { plan: mondayOnly, recipes },
  )
  assert.equal(valid.privateReview.selectedMealCount, 1)
  assertPrivate(valid.summary, valid.privateReview, 5)
})
