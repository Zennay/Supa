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

const STORES = ['dekamarkt', 'plus']
const FIELDS = [
  'evidenceStatus', 'retailerId', 'ingredientId', 'ingredientLabel',
  'requiredAmount', 'requiredUnit', 'observedAt', 'storeLocation',
  'priceContext', 'observedProductName', 'observedPackAmount',
  'observedPackUnit', 'observedPackCount', 'observedPriceEUR',
  'observedAvailability', 'collectionMethod', 'evidenceReference', 'notes',
]

// Deliberately independent RFC 4180 double-quoted CSV parser. It does not
// borrow the formatter or a regular-expression cell splitting approximation.
function parseCsv(csv) {
  assert.equal(typeof csv, 'string')
  assert.ok(csv.endsWith('\n'), 'CSV ends with a complete newline')
  const records = []
  let row = []
  let field = ''
  let pos = 0
  while (pos < csv.length) {
    assert.equal(csv[pos], '"', `field must begin with quote at ${pos}`)
    pos++
    let closed = false
    while (pos < csv.length) {
      if (csv[pos] === '"') {
        if (csv[pos + 1] === '"') {
          field += '"'
          pos += 2
        } else {
          pos++
          closed = true
          break
        }
      } else {
        field += csv[pos++]
      }
    }
    assert.ok(closed, 'closed escaped CSV cell')
    row.push(field)
    field = ''
    if (csv[pos] === ',') {
      pos++
      continue
    }
    assert.equal(csv[pos], '\n', 'only comma or LF after complete cell')
    pos++
    records.push(row)
    row = []
  }
  assert.equal(row.length, 0)
  assert.deepEqual(records[0], FIELDS)
  for (const row of records) assert.equal(row.length, FIELDS.length)
  return records.slice(1).map(row => Object.fromEntries(FIELDS.map((name, i) => [name, row[i]])))
}

async function historical() {
  const base = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, base)))))
}

// Independent selected-meal demand oracle; the archived catalog and its
// potentially priced candidates MUST NOT influence the quantities.
function expectedDemand(plan, recipes, selectedDays) {
  const map = new Map()
  for (const day of selectedDays) {
    const meal = plan.find(item => item.day === day)
    assert.ok(meal, `actual meal for ${day}`)
    const recipe = recipes.find(item => item.id === meal.recipeId)
    assert.ok(recipe, `real recipe for ${meal.recipeId}`)
    for (const item of recipe.ingredients) {
      const current = map.get(item.id)
      if (current) {
        assert.equal(current.unit, item.unit, 'test fixture units unambiguous')
        current.amount += item.amount
      } else {
        map.set(item.id, { label: item.label, amount: item.amount, unit: item.unit })
      }
    }
  }
  return map
}

function assertEmptyPairedRows(result, demand) {
  assert.equal(result.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(result.observedStorePrices, 0)
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  const rows = parseCsv(result.csv)
  assert.equal(rows.length, demand.size * 2)
  assert.equal(result.rows, rows.length)
  const seen = new Set()
  for (const row of rows) {
    assert.equal(row.evidenceStatus, 'UNOBSERVED_TEMPLATE_NOT_EVIDENCE')
    assert.ok(STORES.includes(row.retailerId), 'exact sanctioned retailer')
    const expected = demand.get(row.ingredientId)
    assert.ok(expected, `ingredient ${row.ingredientId} must come from selected plan`)
    assert.equal(row.ingredientLabel, expected.label)
    assert.equal(Number(row.requiredAmount), expected.amount)
    assert.equal(row.requiredUnit, expected.unit)
    assert.equal(row.requiredAmount, String(expected.amount), 'no repriced quantity')
    const key = JSON.stringify([row.retailerId, row.ingredientId])
    assert.ok(!seen.has(key), 'one review row per store and ingredient')
    seen.add(key)
    for (const key of FIELDS.slice(6)) {
      assert.equal(row[key], '', `field ${key} MUST remain unobserved`)
    }
  }
  for (const id of demand.keys()) {
    for (const store of STORES) {
      assert.ok(seen.has(JSON.stringify([store, id])), `paired ${store}/${id}`)
    }
  }
  assert.doesNotMatch(result.csv, /sourceUrl|capturedAt|sha256|priceCents|publicSavingsClaimEligible|productionEnabled/i)
  return rows
}

test('15 selected-day subsets preserve exact demand and 2-store empty evidence on six real archives', async () => {
  const sources = await historical()
  const original = structuredClone(sources)
  const canonicalDays = [...m2DefaultActiveDays]
  assert.deepEqual(canonicalDays, ['Ma', 'Di', 'Wo', 'Do'])
  for (let mask = 1; mask < 1 << canonicalDays.length; mask++) {
    const days = canonicalDays.filter((_, index) => mask & (1 << index))
    const expected = expectedDemand(m2InitialPlan, m2Recipes, days)
    const result = buildPrivateSelectedWeekObservationWorksheet(sources, days)
    assertEmptyPairedRows(result, expected)
    const reverse = buildPrivateSelectedWeekObservationWorksheet([...sources].reverse(), [...days].reverse())
    assert.equal(reverse.csv, result.csv, `canonical output independent of six-source/day order ${mask}`)
  }
  assert.deepEqual(sources, original, 'archives not changed by any worksheet')
})

test('seven actual planned days aggregate independent recipe demand without producing historical prices', async () => {
  const sources = await historical()
  const days = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
  const plan = [
    ...structuredClone(m2InitialPlan),
    { day: 'Vr', recipeId: 'tikka' },
    { day: 'Za', recipeId: 'pasta' },
    { day: 'Zo', recipeId: 'teriyaki' },
  ]
  const recipes = structuredClone(m2Recipes)
  const immutableInputs = structuredClone({plan, recipes})
  const demand = expectedDemand(plan, recipes, days)
  assert.equal(demand.get('chicken-thigh').amount, 900)
  assert.equal(demand.get('basmati-rice').amount, 750)
  assert.equal(demand.get('tomato-cubes').amount, 800)
  const result = buildPrivateSelectedWeekObservationWorksheet(sources, days, {plan, recipes})
  const rows = assertEmptyPairedRows(result, demand)
  for (const store of STORES) {
    assert.ok(rows.some(r => r.retailerId === store && r.ingredientId === 'chicken-thigh' &&
      r.requiredAmount === '900' && r.requiredUnit === 'g'))
    assert.ok(rows.some(r => r.retailerId === store && r.ingredientId === 'basmati-rice' &&
      r.requiredAmount === '750' && r.requiredUnit === 'g'))
  }
  assert.deepEqual({plan, recipes}, immutableInputs, 'personal planner data not modified')
  assert.equal(buildPrivateSelectedWeekObservationWorksheet([...sources].reverse(), [...days].reverse(),
    {plan: [...plan].reverse(), recipes: [...recipes].reverse()}).csv, result.csv,
    'worksheet is deterministic even when all four inputs are reordered')
})

test('changing unselected plan meals cannot alter worksheet; selected meal must update both stores', async () => {
  const sources = await historical()
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  const baseline = buildPrivateSelectedWeekObservationWorksheet(sources, ['Ma'], {plan, recipes})
  const changedUnselected = structuredClone(plan)
  changedUnselected.find(meal => meal.day === 'Do').recipeId = 'pasta'
  assert.equal(buildPrivateSelectedWeekObservationWorksheet(sources, ['Ma'],
    {plan: changedUnselected, recipes}).csv, baseline.csv)
  const changedSelected = structuredClone(recipes)
  changedSelected.find(recipe => recipe.id === 'tikka').ingredients
    .find(item => item.id === 'chicken-thigh').amount = 400
  const changed = buildPrivateSelectedWeekObservationWorksheet(sources, ['Ma'],
    {plan, recipes: changedSelected})
  assert.notEqual(changed.csv, baseline.csv)
  const rows = assertEmptyPairedRows(changed, expectedDemand(plan, changedSelected, ['Ma']))
  assert.equal(rows.filter(row => row.ingredientId === 'chicken-thigh' &&
    row.requiredAmount === '400').length, 2)
  assert.equal(rows.filter(row => row.ingredientId === 'basmati-rice' &&
    row.requiredAmount === '150').length, 2)
})
