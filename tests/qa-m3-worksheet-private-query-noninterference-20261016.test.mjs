import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildPrivateSelectedWeekObservationWorksheet,
} from '../scripts/retailer-private-selected-week-observation.mjs'

async function sanitizedHistoricalSources() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}
const unobserved = (records, days, plan, recipes) =>
  buildPrivateSelectedWeekObservationWorksheet(records, days, { plan, recipes })

function checkBoundary(worksheet, expectedRows) {
  assert.equal(worksheet.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(worksheet.productionReady, false)
  assert.equal(worksheet.publicSavingsClaimEligible, false)
  assert.equal(worksheet.observedStorePrices, 0)
  assert.equal(worksheet.rows, expectedRows)
  assert.equal(worksheet.csv.match(/UNOBSERVED_TEMPLATE_NOT_EVIDENCE/g)?.length, expectedRows)
  assert.doesNotMatch(worksheet.csv, /capturedAt|snapshotSha256|sourceUrl|currentPrice|priceCents|savingsPercent|actualObserved/i)
}

test('eight independent private query and recipe metadata revisions cannot change the 11x2 human field card', async () => {
  const records = await sanitizedHistoricalSources()
  const before = structuredClone(records)
  const canonicalPlan = structuredClone(m2InitialPlan)
  const baseline = unobserved(records, m2DefaultActiveDays, canonicalPlan, structuredClone(m2Recipes))
  checkBoundary(baseline, 22)
  for (let revision = 0; revision < 8; revision++) {
    const recipes = structuredClone(m2Recipes)
    const secretMarker = `INTERNAL_PRIVATE_RECIPE_QUERY_REVISION_${revision}_DO_NOT_EXPORT`
    for (const recipe of recipes) {
      recipe.title = secretMarker + '_title_' + recipe.id
      recipe.minutes = 20 + revision
      recipe.estimatedCost = 9000 + revision
      recipe.tags = [secretMarker + '_private_tag']
      for (const ingredient of recipe.ingredients) {
        // Repeated basmati uses exactly the same private query across meals,
        // preserving the planner's independent definition-drift validation.
        ingredient.query = `${secretMarker}_search_${ingredient.id}`
      }
    }
    const exported = unobserved(records, [...m2DefaultActiveDays].reverse(),
      [...canonicalPlan].reverse(), [...recipes].reverse())
    checkBoundary(exported, 22)
    assert.equal(exported.csv, baseline.csv,
      `no search query, meal title, cost or tag may perturb the human worksheet at revision ${revision}`)
    assert.ok(!exported.csv.includes(secretMarker), 'sensitive local recipe metadata not exported')
  }
  assert.deepEqual(records, before, 'six historical archives cannot be changed by local metadata')
})

test('unselected meal, ingredient and private query edits cannot reach a selected Monday worksheet', async () => {
  const records = await sanitizedHistoricalSources()
  const plan = structuredClone(m2InitialPlan)
  const baseline = unobserved(records, ['Ma'], plan, structuredClone(m2Recipes))
  checkBoundary(baseline, 10)
  const recipes = structuredClone(m2Recipes)
  const pasta = recipes.find(recipe => recipe.id === 'pasta')
  pasta.title = 'PRIVATE_NONSELECTED_RECIPE_TITLE_DO_NOT_EXPORT'
  pasta.tags = ['PRIVATE_NONSELECTED_RECIPE_TAG_DO_NOT_EXPORT']
  for (const ingredient of pasta.ingredients) {
    ingredient.id = 'private-nonselected-' + ingredient.id
    ingredient.label = 'PRIVATE_NONSELECTED_LABEL_DO_NOT_EXPORT'
    ingredient.query = 'PRIVATE_NONSELECTED_SEARCH_DO_NOT_EXPORT'
    ingredient.amount = 9999999999
  }
  const editedPlan = structuredClone(plan)
  editedPlan.find(meal => meal.day === 'Wo').recipeId = 'pasta'
  const worksheet = unobserved(records, ['Ma'], editedPlan, recipes)
  checkBoundary(worksheet, 10)
  assert.equal(worksheet.csv, baseline.csv)
  assert.doesNotMatch(worksheet.csv, /PRIVATE_NONSELECTED|9999999999/)
})

test('the worksheet exposes only unobserved, aggregate-only public API fields', async () => {
  const records = await sanitizedHistoricalSources()
  const result = unobserved(records, ['Ma', 'Do'], structuredClone(m2InitialPlan),
    structuredClone(m2Recipes))
  checkBoundary(result, 10)
  assert.deepEqual(Object.keys(result).sort(),
    ['csv', 'evidenceStatus', 'observedStorePrices', 'productionReady', 'publicSavingsClaimEligible', 'rows'].sort())
  assert.equal(JSON.stringify(result).includes('"productionReady":true'), false)
  assert.equal(JSON.stringify(result).includes('"publicSavingsClaimEligible":true'), false)
  assert.equal(result.csv.match(/"plus"/g)?.length, 5)
  assert.equal(result.csv.match(/"dekamarkt"/g)?.length, 5)
})

test('privately curated search terms never reach the CSV or trigger fetch-side source discovery', async () => {
  const records = await sanitizedHistoricalSources()
  const recipes = structuredClone(m2Recipes)
  const plan = structuredClone(m2InitialPlan)
  const baseline = unobserved(records, ['Ma', 'Do'], plan, structuredClone(m2Recipes))
  const canary = 'PRIVATE_SEARCH_EMAIL_person_at_example_invalid_DO_NOT_EXPORT'
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      ingredient.query = `${canary}_${ingredient.id} signed-in basket 12,35 EUR`
    }
  }

  const savedFetch = globalThis.fetch
  let externalCalls = 0
  globalThis.fetch = () => {
    externalCalls++
    throw new Error('Network access attempted during offline human field preparation')
  }
  try {
    const result = unobserved(records, ['Ma', 'Do'], plan, recipes)
    checkBoundary(result, 10)
    assert.equal(result.csv, baseline.csv)
    assert.equal(externalCalls, 0, 'no fetch while building an offline worksheet')
    assert.ok(!result.csv.includes(canary), 'no private query or user identifier')
    assert.doesNotMatch(result.csv, /signed-in basket|12,35 EUR/)
  } finally {
    globalThis.fetch = savedFetch
  }
})

test('custom recipe getters and proxies are refused without calling untrusted JavaScript', async () => {
  const records = await sanitizedHistoricalSources()
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  let touched = 0
  Object.defineProperty(recipes[0].ingredients[0], 'query', {
    enumerable: true, configurable: true,
    get() { touched++; throw new Error('private getter unexpectedly executed') },
  })
  assert.throws(
    () => unobserved(records, ['Ma'], plan, recipes),
    /inert JSON/i,
    'untrusted query getter must refuse before creating any worksheet',
  )
  assert.equal(touched, 0)
  const cleanRecipes = structuredClone(m2Recipes)
  const guarded = new Proxy(cleanRecipes, {
    get() { touched++; throw new Error('private recipes proxy unexpectedly executed') },
  })
  assert.throws(
    () => unobserved(records, ['Ma'], plan, guarded),
    /inert JSON/i,
  )
  assert.equal(touched, 0)
})
