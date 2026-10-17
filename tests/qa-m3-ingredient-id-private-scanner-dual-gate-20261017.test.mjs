/**
 * Independent GREEN guard composed with original expected-RED label QA.
 * Safe *structural* ingredient IDs must survive the actual six-fixture M3
 * producer -> UTF-8 CSV -> operator scanner; unsafe IDs fail before encoding.
 * This cannot excuse known unresolved human *ingredientLabel* collisions.
 * Entirely offline: zero retailer HTTP, current prices, real observations.
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
import { auditPrivateWorksheetCsv }
  from '../scripts/qa-m3-private-worksheet-preflight.mjs'

const archives = Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readBoundedRegularReviewedFixture(fileURLToPath(
    new URL('../fixtures/m1/' + name, import.meta.url)))))

function exportWire(records, firstId, secondId) {
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].id = firstId
  if (secondId !== undefined) recipes[0].ingredients[1].id = secondId
  return buildPrivateSelectedWeekObservationWorksheet(records, ['Ma'], {
    plan: structuredClone(m2InitialPlan), recipes,
  })
}
function strictOperatorSummary(output) {
  assert.equal(output.productionReady, false)
  assert.equal(output.publicSavingsClaimEligible, false)
  assert.equal(output.observedStorePrices, 0)
  const bytes = Buffer.from(output.csv, 'utf8')
  assert.deepEqual(Buffer.from(bytes.toString('utf8'), 'utf8'), bytes)
  const summary = auditPrivateWorksheetCsv(bytes.toString('utf8'))
  assert.deepEqual([
    summary.rows, summary.ingredientNeeds, summary.pairedRetailers,
    summary.verifiedActualObservations, summary.sourceRightsVerified,
    summary.productionReady, summary.publicSavingsClaimEligible,
  ], [10, 5, 2, 0, false, false, false])
  return bytes
}

test('legal leading minus source IDs retain distinct identity across formula-guard and independent CSV scanner', async () => {
  const records = await archives
  const before = structuredClone(records)
  const ids = ['-a', '-1', '--double', 'a-1', 'a.b', 'a_b', 'a:b']
  const observed = new Set()
  for (const id of ids) {
    const output = exportWire(records, id)
    const bytes = strictOperatorSummary(output)
    assert.ok(output.csv.includes('"plus","' + (id.startsWith('-') ? "'" : '') + id + '",'))
    assert.ok(output.csv.includes('"dekamarkt","' + (id.startsWith('-') ? "'" : '') + id + '",'))
    const hex = bytes.toString('hex')
    assert.equal(observed.has(hex), false, 'distinct safe ID inputs must never share identical operator wire CSV')
    observed.add(hex)
  }
  assert.equal(observed.size, ids.length)
  assert.deepEqual(records, before)
})

test('two JS prototype-named IDs remain separate complete paired rows through independent scanner', async () => {
  const records = await archives
  const output = exportWire(records, '__proto__', 'constructor')
  strictOperatorSummary(output)
  for (const retailer of ['plus', 'dekamarkt']) {
    const lines = output.csv.split('\n').filter(row => row.includes('"' + retailer + '",'))
    assert.equal(lines.filter(row => row.includes('"__proto__",')).length, 1)
    assert.equal(lines.filter(row => row.includes('"constructor",')).length, 1)
  }
})

test('noncanonical source IDs fail atomically before UTF-8 encoding and cannot acquire scanner trust', async () => {
  const records = await archives
  const before = structuredClone(records)
  for (const id of ['\u202e-a', '-\n1', '\ud800', "'-a", '- 1', 'a'.repeat(171)]) {
    assert.throws(() => exportWire(records, id), /identity|invalid|unsupported|refus|catalog|ingredient/iu)
  }
  assert.deepEqual(records, before)
})
