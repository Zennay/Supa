import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildPrivateSelectedWeekObservationWorksheet,
} from '../scripts/retailer-private-selected-week-observation.mjs'

async function historical() {
  const base = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, base)))))
}
function customized(amount, unit = 'g') {
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  const chicken = recipes.find(recipe => recipe.id === 'tikka').ingredients
    .find(ingredient => ingredient.id === 'chicken-thigh')
  chicken.amount = amount
  chicken.unit = unit
  return { plan, recipes }
}
function assertPrivateSuccess(result) {
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.observedStorePrices, 0)
  assert.equal(result.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(result.rows, 10)
  assert.ok(result.csv.includes('UNOBSERVED_TEMPLATE_NOT_EVIDENCE'))
}

test('positive: a genuine ordinary selected recipe quantity is still an unobserved private worksheet', async () => {
  const records = await historical()
  const ordinary = buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], customized(300))
  assertPrivateSuccess(ordinary)
  assert.equal(ordinary.csv.match(/"chicken-thigh","Kippendij","300","g"/g)?.length, 2)
})

test('negative: sub-measurable source-plan amount must not become a real human collection instruction', async () => {
  const records = await historical()
  const source = structuredClone(records)
  const options = customized(1e-14)
  const before = structuredClone(options)
  assert.throws(
    () => buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], options),
    /refused|invalid|quantity|uncollectable|amount/i,
    'a 10-femtogram kitchen ingredient cannot become two operator-fillable gram fields',
  )
  assert.deepEqual(records, source, 'archive unchanged after refusal')
  assert.deepEqual(options, before, 'planner unchanged after refusal')
})

test('negative: astronomical plan amounts must not be certified as collectable rows in scientific notation', async () => {
  const records = await historical()
  for (const invalid of [1e21, Number.MAX_VALUE]) {
    const options = customized(invalid)
    assert.throws(
      () => buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], options),
      /refused|invalid|quantity|uncollectable|amount/i,
      `the CSV human-observation gate must refuse amount ${invalid}, not publish an exponential field`,
    )
  }
})
