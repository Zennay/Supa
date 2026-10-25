import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'
import { auditPrivateWorksheetCsv } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

async function sources() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}
const worksheet = (captureRows, days, recipes = structuredClone(m2Recipes)) =>
  buildPrivateSelectedWeekObservationWorksheet(captureRows, days, {
    plan: structuredClone(m2InitialPlan), recipes,
  })

test('visual line/paragraph separators cannot smuggle a false second product/store row', async () => {
  const captureRows = await sources()
  for (const [character, name] of [
    ['\u0085', 'NEXT LINE (U+0085)'],
    ['\u2028', 'LINE SEPARATOR (U+2028)'],
    ['\u2029', 'PARAGRAPH SEPARATOR (U+2029)'],
  ]) {
    const recipes = structuredClone(m2Recipes)
    recipes[0].ingredients[0].label = 'Kippendij' + character + 'DekaMarkt: €0,01'
    const data = worksheet(captureRows, ['Ma'], recipes)
    assert.equal(data.rows, 10)
    assert.equal(data.productionReady, false)
    assert.equal(data.observedStorePrices, 0)
    assert.throws(() => auditPrivateWorksheetCsv(data.csv),
      /Private worksheet QA audit refused/, name)
  }
})

test('legitimate nonbreaking spaces and native multilingual visible labels stay readable', async () => {
  const captureRows = await sources()
  for (const label of [
    'Crème\u00a0fraîche', 'Pão de queijo', 'Basmati أرز',
    '👩‍🍳 Kokosmelk', 'मीठा क्‍ष', 'می‌روم',
  ]) {
    const recipes = structuredClone(m2Recipes)
    recipes[0].ingredients[0].label = label
    const data = worksheet(captureRows, ['Ma'], recipes)
    const report = auditPrivateWorksheetCsv(data.csv)
    assert.equal(report.rows, 10)
    assert.equal(report.verifiedActualObservations, 0)
    assert.equal(report.productionReady, false)
    assert.equal(report.publicSavingsClaimEligible, false)
  }
})

test('preflight accepts each of 15 exact nonempty official four-day meal selection subsets', async () => {
  const captureRows = await sources()
  const snapshot = structuredClone(captureRows)
  assert.equal(m2DefaultActiveDays.length, 4)
  let accepted = 0
  for (let mask = 1; mask < (1 << m2DefaultActiveDays.length); mask++) {
    const days = m2DefaultActiveDays.filter((_, i) => (mask & (1 << i)) !== 0)
    const template = worksheet(captureRows, days)
    const sameReordered = worksheet(captureRows, [...days].reverse())
    assert.equal(sameReordered.csv, template.csv, 'day ordering must not change field card')
    const result = auditPrivateWorksheetCsv(template.csv)
    assert.equal(result.rows, template.rows)
    assert.equal(result.ingredientNeeds * 2, template.rows)
    assert.equal(result.pairedRetailers, 2)
    assert.equal(result.productionReady, false)
    assert.equal(result.verifiedActualObservations, 0)
    assert.equal(result.sourceRightsVerified, false)
    accepted++
  }
  assert.equal(accepted, 15)
  assert.deepEqual(captureRows, snapshot, 'historical archived source material is immutable')
})
