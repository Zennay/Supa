import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { aggregatePlanIngredients } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildCivilClockCheckedPrivatePlannedWeek } from '../scripts/retailer-private-civil-week-bridge.mjs'

// Independent QA1 exhaustive day-selection acceptance on the opt-in #3712
// private M3 bridge. Six fixed sanitized archives only; no HTTP or prices.
const STORES = ['plus', 'dekamarkt']

async function historicalSources() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}

function assertExactRows(result, plan, recipes, days) {
  const expected = aggregatePlanIngredients(plan, recipes, days)
  assert.equal(result.privateReview.selectedMealCount, days.length)
  assert.equal(result.summary.activeDays, days.length)
  assert.equal(result.summary.ingredientNeeds, expected.length)
  assert.equal(result.summary.retailerReviewRows, expected.length * STORES.length)
  const rows = result.privateReview.preview.rows
  assert.equal(rows.length, expected.length * STORES.length)
  for (const store of STORES) {
    const own = rows.filter(row => row.retailerId === store)
    assert.equal(own.length, expected.length)
    const byId = new Map(own.map(row => [row.ingredientId, row]))
    assert.equal(byId.size, expected.length, 'store must not silently double-count any ingredient')
    for (const need of expected) {
      const found = byId.get(need.id)
      assert.ok(found, 'store must retain every selected actual recipe ingredient')
      assert.equal(found.ingredientLabel, need.label)
      assert.deepEqual(found.required, { amount: need.amount, unit: need.unit })
      assert.ok(['unresolved', 'suggested-for-manual-review'].includes(found.status))
      if (found.status === 'unresolved') assert.equal(found.candidate, null)
      if (found.candidate !== null) {
        assert.equal(found.status, 'suggested-for-manual-review')
        assert.ok(found.candidate.canonicalKey.startsWith(store + ':'),
          'never offer another supermarket\'s historical product as this store\'s candidate')
      }
    }
  }
  assert.equal(result.privateReview.livePriceClaimsAllowed, false)
  assert.equal(result.summary.productionReady, false)
  assert.equal(result.summary.sourcePermissionVerified, false)
  assert.equal(result.summary.publicSavingsClaimEligible, false)
  assert.equal(result.summary.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(result.summary), /https:\/\/|priceCents|snapshotSha256|capturedAt|totalCents/i)
}

test('all 15 nonempty combinations of real Ma/Di/Wo/Do planner days conserve exact demand per retailer', async t => {
  const records = await historicalSources()
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  const days = ['Ma', 'Di', 'Wo', 'Do']
  for (let mask = 1; mask < 1 << days.length; mask += 1) {
    const selected = days.filter((_, index) => (mask & (1 << index)) !== 0)
    await t.test(selected.join('+'), () => {
      const result = buildCivilClockCheckedPrivatePlannedWeek(
        records, selected, { plan, recipes },
      )
      assertExactRows(result, plan, recipes, selected)
    })
  }
})

test('a genuine seven-day local recipe plan makes seven meals but never seven fake live-price baskets', async () => {
  const records = await historicalSources()
  const plan = [
    ...structuredClone(m2InitialPlan),
    { day: 'Vr', recipeId: 'teriyaki' },
    { day: 'Za', recipeId: 'pasta' },
    { day: 'Zo', recipeId: 'tikka' },
  ]
  const recipes = structuredClone(m2Recipes)
  const days = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
  const result = buildCivilClockCheckedPrivatePlannedWeek(
    records, days, { plan, recipes },
  )
  assertExactRows(result, plan, recipes, days)
  assert.equal(result.summary.activeDays, 7)
  assert.equal(result.summary.ingredientNeeds, 11)
  assert.equal(result.summary.retailerReviewRows, 22)
  const chicken = result.privateReview.preview.rows.filter(row => row.ingredientId === 'chicken-thigh')
  assert.equal(chicken.length, 2)
  assert.ok(chicken.every(row => row.required.amount === 900 && row.required.unit === 'g'))
  const rice = result.privateReview.preview.rows.filter(row => row.ingredientId === 'basmati-rice')
  assert.equal(rice.length, 2)
  assert.ok(rice.every(row => row.required.amount === 750 && row.required.unit === 'g'))
})
