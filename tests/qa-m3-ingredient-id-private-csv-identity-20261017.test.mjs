/**
 * Independent M3 positive source-identity contract.
 *
 * The operator label escape has known expected-RED fidelity gaps. This suite
 * proves the SEPARATE ingredientId trust boundary is not affected: no C0,
 * Unicode confusables, formula apostrophes or unsafe delimiter can reach CSV
 * via actual six-source offline planner, while every admitted ASCII ID stays
 * distinguishable in the final human worksheet.
 * No retailer requests, actual shelf prices, human evidence or rights claim.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet }
  from '../scripts/retailer-private-selected-week-observation.mjs'

const archives = Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readBoundedRegularReviewedFixture(fileURLToPath(
    new URL('../fixtures/m1/' + name, import.meta.url)))))

function sheetWithId(records, ingredientId) {
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].id = ingredientId
  return buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], {
    plan: structuredClone(m2InitialPlan), recipes,
  })
}

test('real six-source selected-day worksheet preserves accepted canonical ASCII ingredient IDs', async () => {
  const records = await archives
  const before = structuredClone(records)
  const examples = ['chicken-thigh', 'chicken.thigh', 'chicken_thigh', 'chicken:thigh', 'A123z']
  const seenCsv = new Set()
  for (const id of examples) {
    const output = sheetWithId(records, id)
    assert.equal(output.rows, 10)
    assert.equal(output.productionReady, false)
    assert.equal(output.publicSavingsClaimEligible, false)
    assert.equal(output.observedStorePrices, 0)
    assert.ok(output.csv.includes('"plus","' + id + '"'))
    assert.ok(output.csv.includes('"dekamarkt","' + id + '"'))
    assert.equal(seenCsv.has(output.csv), false, 'valid source IDs must remain byte-distinct')
    seenCsv.add(output.csv)
    for (const record of records) assert.equal(output.csv.includes(record.source.url), false)
  }
  assert.equal(seenCsv.size, examples.length)
  assert.deepEqual(records, before)
})

for (const [name, id] of [
  ['LF', 'chicken\nthigh'],
  ['CR', 'chicken\rthigh'],
  ['tab', 'chicken\tthigh'],
  ['NUL', 'chicken\u0000thigh'],
  ['DEL', 'chicken\u007fthigh'],
  ['visible space', 'chicken thigh'],
  ['apostrophe', "'=1+1"],
  ['spreadsheet formula prefix', '=1+1'],
  ['unicode confusable fullwidth', 'ｃhicken'],
  ['unicode right-to-left spoof', 'chicken\u202ethigh'],
  ['zero-width joiner', 'chicken\u200dthigh'],
  ['emoji', 'chicken🍗'],
  ['empty ID', ''],
  ['oversize ID', 'a'.repeat(171)],
]) {
  test('real worksheet refuses unsupported ingredientId before any output: ' + name, async () => {
    const records = await archives
    assert.throws(() => sheetWithId(records, id),
      /invalid|unsupported|identity|refused|ingredient|catalog/i)
  })
}

test('different admitted IDs cannot be collapsed into one operator row pair', async () => {
  const records = await archives
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].id = 'canonical:1'
  recipes[0].ingredients[1].id = 'canonical.1'
  const result = buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], {
    plan: structuredClone(m2InitialPlan), recipes,
  })
  assert.equal(result.rows, 10)
  for (const store of ['plus', 'dekamarkt']) {
    assert.equal(result.csv.split('\n').filter(row =>
      row.includes('"' + store + '","canonical:1",')).length, 1)
    assert.equal(result.csv.split('\n').filter(row =>
      row.includes('"' + store + '","canonical.1",')).length, 1)
  }
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})
