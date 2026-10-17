/**
 * Independent M3 source→UTF-8 operator CSV→strict QA preflight identity gate.
 * Combines unchanged producer #3718 with unchanged scanner #3724.
 * No retailer HTTP, live prices, observations, rights or production release.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'
import { auditPrivateWorksheetCsv } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

const archives = Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readBoundedRegularReviewedFixture(fileURLToPath(new URL('../fixtures/m1/' + name, import.meta.url)))))

function exportAndScan(records, label) {
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = label
  let result
  try {
    result = buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], {
      plan: structuredClone(m2InitialPlan), recipes,
    })
  } catch (error) {
    assert.match(String(error), /refus|invalid|label|ingredient|planner|recipe/iu)
    return null // Atomic source refusal is acceptable.
  }
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.observedStorePrices, 0)
  const wireBytes = Buffer.from(result.csv, 'utf8')
  const preflight = auditPrivateWorksheetCsv(wireBytes.toString('utf8'))
  assert.equal(preflight.rows, 10)
  assert.equal(preflight.verifiedActualObservations, 0)
  assert.equal(preflight.sourceRightsVerified, false)
  assert.equal(preflight.productionReady, false)
  assert.equal(preflight.publicSavingsClaimEligible, false)
  return wireBytes
}
test('genuine Unicode, accents and U+FFFD retain distinguishable source identities', async () => {
  const records = await archives
  const first = exportAndScan(records, 'Crème 🥦 Kip')
  const second = exportAndScan(records, 'Crème � Kip')
  assert.ok(first !== null && second !== null)
  assert.ok(!first.equals(second))
})
for (const [name, left, right] of [
  ['formula apostrophe escape', '=1+1', "'=1+1"],
  ['malformed UTF-16 high surrogate', 'Kip\ud800Borst', 'Kip\ufffdBorst'],
]) {
  test('distinct planner labels must never alias after producer→UTF-8→scanner: ' + name, async () => {
    const records = await archives
    assert.notEqual(left, right)
    const fromLeft = exportAndScan(records, left)
    const fromRight = exportAndScan(records, right)
    if (fromLeft !== null && fromRight !== null) {
      assert.ok(!fromLeft.equals(fromRight),
        'operator preflight accepted byte-identical worksheets from different source labels')
    }
  })
}
