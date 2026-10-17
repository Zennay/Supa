import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'

// Unicode NEXT LINE / LINE SEPARATOR / PARAGRAPH SEPARATOR may render as
// visual line breaks in printed or spreadsheet-shared operator worksheets,
// even when the RFC 4180 CSV rows are structurally quoted.
const VISUAL_NEWLINES = /[\u0085\u2028\u2029]/u

async function historicalSources() {
  const directory = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(filename =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(filename, directory)))))
}

function originalPlanWithIngredientLabel(label) {
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = label
  return { plan, recipes }
}

function assertPrivateWorksheet(result) {
  assert.equal(result.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(result.rows, 10)
  assert.equal(result.observedStorePrices, 0)
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal((result.csv.match(/UNOBSERVED_TEMPLATE_NOT_EVIDENCE/g) ?? []).length, 10)
  // The two actual operator-facing rows must carry the same ingredient.
  assert.equal((result.csv.match(/"chicken-thigh"/g) ?? []).length, 2)
}

test('human CSV still supports ordinary accented, RTL-letter and emoji ingredient labels', async () => {
  const records = await historicalSources()
  const frozen = structuredClone(records)
  for (const label of ['Crème fraîche 🍅', 'Rijst أرز', 'Paneer कढ़ी', 'Pão de queijo']) {
    const result = buildPrivateSelectedWeekObservationWorksheet(
      records, ['Ma'], originalPlanWithIngredientLabel(label))
    assertPrivateWorksheet(result)
    assert.ok(result.csv.includes('"' + label + '"'), 'genuine label remains readable')
    assert.equal(VISUAL_NEWLINES.test(result.csv), false)
  }
  assert.deepEqual(records, frozen, 'private historical captures remain untouched')
})

for (const [name, separator] of [
  ['NEXT LINE (U+0085)', '\u0085'],
  ['LINE SEPARATOR (U+2028)', '\u2028'],
  ['PARAGRAPH SEPARATOR (U+2029)', '\u2029'],
]) {
  test(`operator worksheet must refuse or remove visual Unicode newline ${name}`, async () => {
    const records = await historicalSources()
    const frozen = structuredClone(records)
    // The label is legitimate local planner input, not a retailer-origin claim.
    // It must not split one printed shopping item into apparently separate lines.
    const label = `Kippendij${separator}DekaMarkt: gratis`
    let result
    try {
      result = buildPrivateSelectedWeekObservationWorksheet(
        records, ['Ma'], originalPlanWithIngredientLabel(label))
    } catch (error) {
      assert.ok(error instanceof Error, 'fail-closed refusal uses a normal Error')
      assert.deepEqual(records, frozen)
      return
    }
    assertPrivateWorksheet(result)
    assert.equal(VISUAL_NEWLINES.test(result.csv), false,
      'strict CSV quoting alone cannot prevent visual operator-line spoofing')
    assert.deepEqual(records, frozen)
  })
}

for (const [name, malformed] of [
  ['unpaired HIGH SURROGATE (U+D800)', '\uD800'],
  ['unpaired LOW SURROGATE (U+DC00)', '\uDC00'],
]) {
  test(`operator worksheet refuses lossy UTF-8 ingredient identity from ${name}`, async () => {
    const records = await historicalSources()
    const frozen = structuredClone(records)
    // An unpaired UTF-16 surrogate cannot be encoded faithfully in UTF-8.
    // Buffer/stdout otherwise silently replaces it with U+FFFD, changing
    // the operator-visible ingredient without changing the source plan.
    const label = `Kippendij${malformed}100g`
    assert.throws(() => buildPrivateSelectedWeekObservationWorksheet(
      records, ['Ma'], originalPlanWithIngredientLabel(label)),
    Error, 'lossy surrogate labels must fail before the human sheet is emitted')
    assert.deepEqual(records, frozen)
  })
}
