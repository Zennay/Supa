/**
 * Independent M3 operator-label fidelity regression on frozen product #3718.
 * Offline sanitized historical PLUS/Deka fixtures only. No live retailer
 * requests, current prices, human evidence, source permissions or deployment.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'

const capturedFixtures = Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readBoundedRegularReviewedFixture(fileURLToPath(new URL('../fixtures/m1/' + name, import.meta.url)))))

function tryTemplate(records, label) {
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = label
  try {
    const output = buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], {
      plan: structuredClone(m2InitialPlan),
      recipes,
    })
    assert.equal(output.rows, 10)
    assert.equal(output.productionReady, false)
    assert.equal(output.publicSavingsClaimEligible, false)
    assert.equal(output.observedStorePrices, 0)
    assert.equal((output.csv.match(/"UNOBSERVED_TEMPLATE_NOT_EVIDENCE"/gu) || []).length, 10)
    return output.csv
  } catch (error) {
    // Either refuse potentially ambiguous source text atomically, or emit
    // a worksheet whose source ingredient identities remain distinguishable.
    // No callbacks, files or outbound bytes occur along this producer path.
    assert.match(String(error), /refus|invalid|label|ingredient|planner|recipe/iu)
    return null
  }
}

test('benign visible apostrophe is a distinct source label and must stay distinguishable', async () => {
  const records = await capturedFixtures
  const normal = tryTemplate(records, 'Kippendij')
  const literal = tryTemplate(records, "'Kippendij")
  assert.ok(normal !== null)
  assert.ok(literal !== null)
  assert.notEqual(normal, literal)
  assert.match(literal, /"plus","chicken-thigh","'Kippendij"/u)
})

for (const [name, formula, literal] of [
  ['equals', '=1+1', "'=1+1"],
  ['plus', '+SUM(1,2)', "'+SUM(1,2)"],
  ['minus', '-10+20', "'-10+20"],
  ['at-sign', '@SUM(A1)', "'@SUM(A1)"],
  ['spaces before equals', '  =1+1', "'  =1+1"],
]) {
  test('source formula-guard prefix cannot alias a literal apostrophe ingredient: ' + name, async () => {
    const records = await capturedFixtures
    const original = tryTemplate(records, formula)
    const alreadyQuoted = tryTemplate(records, literal)
    // An explicit refusal is safe; when both are supported, the emitted
    // operator worksheets MUST preserve the original label distinction.
    if (original !== null && alreadyQuoted !== null) {
      assert.ok(original !== alreadyQuoted,
        'different original selected-plan ingredient labels produced byte-identical human worksheets')
    }
  })
}
