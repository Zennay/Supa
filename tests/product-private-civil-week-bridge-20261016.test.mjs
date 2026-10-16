import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildCivilClockCheckedPrivatePlannedWeek,
  main,
} from '../scripts/retailer-private-civil-week-bridge.mjs'

async function realFixtures() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}
function alias(iso, hours) {
  const local = new Date(Date.parse(iso) + hours * 3600000).toISOString().slice(0, 23)
  return local + (hours < 0 ? '-' : '+') +
    String(Math.abs(hours)).padStart(2, '0') + ':00'
}

test('all six historical adapters feed a real planner week without granting prices or release rights', async () => {
  const originals = await realFixtures()
  const before = structuredClone(originals)
  const result = buildCivilClockCheckedPrivatePlannedWeek(originals)
  assert.equal(result.summary.mode, 'historical-planned-week-private-review-only')
  assert.equal(result.summary.reviewedArchivedSources, 6)
  assert.equal(result.summary.activeDays, m2DefaultActiveDays.length)
  assert.equal(result.summary.ingredientNeeds, 11)
  assert.equal(result.summary.retailerReviewRows, 22)
  assert.equal(result.privateReview.preview.rows.length, 22)
  assert.deepEqual(Object.keys(result.summary.perRetailer), ['plus', 'dekamarkt'])
  for (const retailer of ['plus', 'dekamarkt']) {
    const { suggestedForManualReview, unresolved } = result.summary.perRetailer[retailer]
    assert.equal(suggestedForManualReview + unresolved, 11)
  }
  assert.equal(result.summary.requiresCurrentHumanObservation, true)
  assert.equal(result.summary.sourcePermissionVerified, false)
  assert.equal(result.summary.productionReady, false)
  assert.equal(result.summary.livePricesAvailable, false)
  assert.equal(result.summary.publicSavingsClaimEligible, false)
  assert.equal(result.summary.externalRequests, 0)
  assert.deepEqual(originals, before)
  assert.doesNotMatch(JSON.stringify(result.summary),
    /sourceUrl|capturedAt|sha256|currentPrice|priceCents|https:\/\/|access_token|productName/i)
})

test('user-selected plan days recompute actual recipe demand and paired human-review rows', async () => {
  const records = await realFixtures()
  const monday = buildCivilClockCheckedPrivatePlannedWeek(records, ['Ma'])
  const twice = buildCivilClockCheckedPrivatePlannedWeek(records, ['Ma', 'Do'])
  assert.deepEqual([monday.summary.activeDays, monday.summary.ingredientNeeds, monday.summary.retailerReviewRows],
    [1, 5, 10])
  assert.deepEqual([twice.summary.activeDays, twice.summary.ingredientNeeds, twice.summary.retailerReviewRows],
    [2, 5, 10])
  const chicken = twice.privateReview.preview.rows.filter(row => row.ingredientId === 'chicken-thigh')
  assert.equal(chicken.length, 2)
  assert.ok(chicken.every(row => row.required.amount === 600 && row.required.unit === 'g'))
  const single = monday.privateReview.preview.rows.filter(row => row.ingredientId === 'chicken-thigh')
  assert.ok(single.every(row => row.required.amount === 300))
  assert.equal(twice.privateReview.livePriceClaimsAllowed, false)
})

test('an invalid, partial, duplicate or unapproved physical source refuses the entire planned-week bridge', async () => {
  const original = await realFixtures()
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(original.slice(0, 5)), /bridge refused/)
  const negativeUtc = structuredClone(original)
  negativeUtc[0].source.capturedAt = alias(negativeUtc[0].source.capturedAt, -13)
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(negativeUtc), /civil-clock preflight refused/)
  const aliasBatch = structuredClone(original)
  const renamed = structuredClone(aliasBatch[0])
  renamed.source.id += '-renamed'
  renamed.source.capturedAt = alias(renamed.source.capturedAt, 2)
  aliasBatch.push(renamed)
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(aliasBatch), /civil-clock preflight refused/)
  const bareQuery = structuredClone(original)
  bareQuery[2].source.url += '?'
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(bareQuery), /civil-clock preflight refused/)
  const future = structuredClone(original)
  future[3].source.capturedAt = '2099-01-01T00:00:00Z'
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(future), /civil-clock preflight refused/)
})

test('invalid or untrusted day selection fails before historical fixture consumption', async () => {
  const originals = await realFixtures()
  for (const days of [[], ['Ma','Ma'], ['Vr'], [' Ma'], ['Ma','?'], [null]]) {
    assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(originals, days))
  }
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(originals, new Proxy(['Ma'], {})),
    /inert JSON/)
  let touched = 0
  const poisoned = ['Ma']
  Object.defineProperty(poisoned, 0, { enumerable: true, get() { touched++; throw Error('getter fired') } })
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(originals, poisoned), /inert JSON/)
  assert.equal(touched, 0)
})


test('real custom local recipe plan supports Friday and repeat-recipe scaling without source promotion', async () => {
  const records = await realFixtures()
  const customPlan = [
    ...structuredClone(m2InitialPlan),
    { day: 'Vr', recipeId: 'tikka' },
  ]
  const customRecipes = structuredClone(m2Recipes)
  const originalPlan = structuredClone(customPlan)
  const result = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma', 'Do', 'Vr'], { plan: customPlan, recipes: customRecipes },
  )
  assert.equal(result.summary.selectedPlanSource, 'custom-private')
  assert.equal(result.summary.activeDays, 3)
  assert.equal(result.summary.ingredientNeeds, 5)
  assert.equal(result.summary.retailerReviewRows, 10)
  assert.equal(result.summary.publicSavingsClaimEligible, false)
  assert.equal(result.summary.externalRequests, 0)
  const chicken = result.privateReview.preview.rows.filter(row => row.ingredientId === 'chicken-thigh')
  assert.equal(chicken.length, 2)
  assert.ok(chicken.every(row => row.required.amount === 900 && row.required.unit === 'g'))
  assert.deepEqual(customPlan, originalPlan)
  const friday = buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Vr'], { plan: customPlan, recipes: customRecipes },
  )
  assert.equal(friday.summary.ingredientNeeds, 5)
  assert.equal(friday.summary.retailerReviewRows, 10)
  assert.doesNotMatch(JSON.stringify(friday.summary), /sourceUrl|capturedAt|priceCents|https:\/\//)
})

test('custom planner inputs fail atomically for missing recipes, drift, forged keys, Proxy and getters', async () => {
  const records = await realFixtures()
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma'], { plan, recipes: recipes.slice(1) }), /Missing recipe/)
  const duplicate = [...plan, { day: 'Ma', recipeId: 'tikka' }]
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma'], { plan: duplicate, recipes }), /Ambiguous planned day/)
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma'], { plan, recipes, permissionVerified: true }), /bridge refused/)
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(
    records, ['Ma'], { plan, recipes: [] }), /bridge refused/)
  const poisoned = { plan, recipes }
  let touched = 0
  Object.defineProperty(poisoned, 'plan', {
    enumerable: true,
    get() { touched++; throw Error('getter executed') },
  })
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(records, ['Ma'], poisoned), /inert JSON/)
  assert.equal(touched, 0)
  const proxy = new Proxy({ plan, recipes }, {
    get() { touched++; throw Error('proxy executed') },
  })
  assert.throws(() => buildCivilClockCheckedPrivatePlannedWeek(records, ['Ma'], proxy), /inert JSON/)
  assert.equal(touched, 0)
})

test('offline CLI emits aggregate-only JSON for canonical days, never retailer product evidence', async () => {
  let output = ''
  const result = await main(['--days', 'Ma,Do'], value => { output += value })
  assert.deepEqual(JSON.parse(output), result)
  assert.equal(result.ingredientNeeds, 5)
  assert.equal(result.retailerReviewRows, 10)
  assert.doesNotMatch(output,
    /sourceUrl|capturedAt|sha256|currentPrice|priceCents|https:\/\/|Kippendij|productName/i)
  const standard = await main([], () => {})
  assert.equal(standard.ingredientNeeds, 11)
  for (const invalid of [
    ['--days', 'Ma,Ma'], ['--days','Vr'], ['--days','Ma, Do'],
    ['--output','x'], ['--days'], ['--days','Ma','--output','x'],
  ]) await assert.rejects(main(invalid, () => {}))
  let trapped = 0
  const hostile = new Proxy([], { get() { trapped++; throw Error('proxy fired') } })
  await assert.rejects(main(hostile, () => {}), /inert JSON/)
  assert.equal(trapped, 0)
})
