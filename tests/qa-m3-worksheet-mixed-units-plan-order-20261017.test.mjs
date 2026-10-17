/**
 * Independent P2 M3 QA — source-plan order must not change human worksheet
 * representation for the SAME selected ingredient demand across compatible
 * mass units. Uses six original sanitized historical PLUS/Deka captures.
 * No live fetching, observed store price, rights or savings entitlement.
 *
 * Expected RED on frozen product owner #3718: aggregation retains the first
 * encountered compatible unit and serializes physically equal 0.2 kg/200 g
 * demand as different CSV bytes when plan order is reversed.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet }
  from '../scripts/retailer-private-selected-week-observation.mjs'
import { auditPrivateWorksheetCsv }
  from '../scripts/qa-m3-private-worksheet-preflight.mjs'

const originalArchives = Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readBoundedRegularReviewedFixture(fileURLToPath(
    new URL('../fixtures/m1/' + name, import.meta.url)))))

function selected(recipes, plan, archived) {
  return buildPrivateSelectedWeekObservationWorksheet(archived, ['Ma', 'Di'], {
    plan, recipes,
  })
}

function privateSummary(output, needs = 8) {
  assert.equal(output.productionReady, false)
  assert.equal(output.publicSavingsClaimEligible, false)
  assert.equal(output.observedStorePrices, 0)
  assert.equal(output.rows, needs * 2)
  const audited = auditPrivateWorksheetCsv(output.csv)
  assert.deepEqual([
    audited.rows, audited.ingredientNeeds, audited.pairedRetailers,
    audited.verifiedActualObservations, audited.sourceRightsVerified,
    audited.productionReady, audited.publicSavingsClaimEligible,
  ], [needs * 2, needs, 2, 0, false, false, false])
  assert.doesNotMatch(output.csv, /sourceUrl|capturedAt|priceCents|publicSavingsClaimEligible/i)
}

function basmatiPairs(csv) {
  const entries = csv.split('\n')
    .filter(row => row.includes('"basmati-rice",'))
    .map(row => {
      const match = row.match(/^"UNOBSERVED_TEMPLATE_NOT_EVIDENCE","(plus|dekamarkt)","basmati-rice","Basmati rijst","([^"]+)","(g|kg)",/)
      assert.ok(match, 'exact paired original ingredient identity and human amount')
      return {store: match[1], amount: match[2], unit: match[3]}
    })
  assert.deepEqual(entries.map(item => item.store).sort(), ['dekamarkt', 'plus'])
  return entries
}

test('control: matching unit notation preserves exact CSV under original and reversed plan', async () => {
  const archives = await originalArchives
  const original = structuredClone(archives)
  const recipes = structuredClone(m2Recipes)
  recipes.find(recipe => recipe.id === 'tikka').ingredients
    .find(ingredient => ingredient.id === 'basmati-rice').amount = 0.1
  recipes.find(recipe => recipe.id === 'teriyaki').ingredients
    .find(ingredient => ingredient.id === 'basmati-rice').amount = 0.2
  const plan = structuredClone(m2InitialPlan)
  const regular = selected(recipes, plan, archives)
  const reversed = selected(recipes, [...plan].reverse(), [...archives].reverse())
  privateSummary(regular)
  privateSummary(reversed)
  assert.deepEqual(basmatiPairs(regular.csv).map(({amount, unit}) => [amount, unit]),
    [['0.3', 'g'], ['0.3', 'g']])
  assert.equal(regular.csv, reversed.csv, 'same-unit fractional recipe sum is deterministic')
  assert.deepEqual(archives, original, 'sanitized original retailer evidence is read-only')
})

test('control: mixed physical quantities are equally usable and operator-safe', async () => {
  const archives = await originalArchives
  const recipes = structuredClone(m2Recipes)
  const tick = recipes.find(recipe => recipe.id === 'tikka').ingredients
    .find(ingredient => ingredient.id === 'basmati-rice')
  const teriyaki = recipes.find(recipe => recipe.id === 'teriyaki').ingredients
    .find(ingredient => ingredient.id === 'basmati-rice')
  tick.amount = 0.1
  tick.unit = 'kg'
  teriyaki.amount = 100
  teriyaki.unit = 'g'
  const plan = structuredClone(m2InitialPlan)
  const forward = selected(recipes, plan, archives)
  const reverse = selected(recipes, [...plan].reverse(), archives)
  privateSummary(forward)
  privateSummary(reverse)
  for (const item of basmatiPairs(forward.csv)) {
    assert.equal(Number(item.amount) * (item.unit === 'kg' ? 1000 : 1), 200)
  }
  for (const item of basmatiPairs(reverse.csv)) {
    assert.equal(Number(item.amount) * (item.unit === 'kg' ? 1000 : 1), 200)
  }
})

test('P2 expected RED: equivalent selected demand has canonical unit and identical bytes regardless of plan array order', async () => {
  const archives = await originalArchives
  const recipes = structuredClone(m2Recipes)
  const plan = structuredClone(m2InitialPlan)
  recipes.find(recipe => recipe.id === 'tikka').ingredients
    .find(ingredient => ingredient.id === 'basmati-rice').amount = 0.1
  recipes.find(recipe => recipe.id === 'tikka').ingredients
    .find(ingredient => ingredient.id === 'basmati-rice').unit = 'kg'
  recipes.find(recipe => recipe.id === 'teriyaki').ingredients
    .find(ingredient => ingredient.id === 'basmati-rice').amount = 100
  const forward = selected(recipes, plan, archives)
  const reverse = selected(recipes, [...plan].reverse(), [...archives].reverse())
  privateSummary(forward)
  privateSummary(reverse)
  const one = basmatiPairs(forward.csv)
  const two = basmatiPairs(reverse.csv)
  assert.deepEqual(one.map(({amount, unit}) => [amount, unit]), [['0.2', 'kg'], ['0.2', 'kg']])
  assert.deepEqual(two.map(({amount, unit}) => [amount, unit]), [['200', 'g'], ['200', 'g']])
  assert.equal(forward.csv, reverse.csv,
    'same two selected meals and same 200 g recipe demand MUST produce identical operator CSV bytes')
  assert.equal(createHash('sha256').update(forward.csv).digest('hex'),
    createHash('sha256').update(reverse.csv).digest('hex'),
    'same source plan demand must not change operator-file SHA')
})


test('P2 expected RED: equal l/ml selected need must be canonical across opposite meal orders', async () => {
  const archives = await originalArchives
  const recipes = structuredClone(m2Recipes)
  const first = recipes.find(recipe => recipe.id === 'tikka').ingredients
    .find(ingredient => ingredient.id === 'coconut-milk')
  const second = recipes.find(recipe => recipe.id === 'teriyaki').ingredients
    .find(ingredient => ingredient.id === 'teriyaki-sauce')
  first.amount = 0.1
  first.unit = 'l'
  second.id = first.id
  second.label = first.label
  second.query = first.query
  second.amount = 100
  second.unit = 'ml'
  const plan = structuredClone(m2InitialPlan)
  const regular = selected(recipes, plan, archives)
  const reverse = selected(recipes, [...plan].reverse(), archives)
  privateSummary(regular, 7)
  privateSummary(reverse, 7)
  for (const sheet of [regular, reverse]) {
    const matching = sheet.csv.split('\n').filter(row => row.includes('"coconut-milk",'))
    assert.equal(matching.length, 2, 'one complete requirement per store')
    const matches = matching.map(row => row.match(/"([0-9.]+)","(l|ml)",/))
    assert.ok(matches.every(Boolean), 'readable valid volume requirement')
    assert.ok(matches.every(([, amount, unit]) =>
      Number(amount) * (unit === 'l' ? 1000 : 1) === 200), 'both mean exactly 200 ml')
  }
  assert.equal(regular.csv, reverse.csv,
    'identical 200 ml requirement must not change human worksheet bytes when plan order reverses')
})
