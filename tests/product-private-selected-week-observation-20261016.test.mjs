import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet, main } from '../scripts/retailer-private-selected-week-observation.mjs'

async function fixtures() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}
function rows(csv) { return csv.trimEnd().split('\n') }

test('six genuine offline historical captures produce blank paired manual worksheet, never inferred shelf prices', async () => {
  const records = await fixtures()
  const before = structuredClone(records)
  const result = buildPrivateSelectedWeekObservationWorksheet(records, ['Ma', 'Do'])
  assert.equal(result.rows, 10)
  assert.equal(result.observedStorePrices, 0)
  assert.equal(result.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(result.productionReady, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(rows(result.csv).length, 11)
  assert.equal(rows(result.csv)[0].match(/"(?:[^"]|"")*"/g).length, 18)
  for (const row of rows(result.csv).slice(1)) {
    const cells = row.match(/"(?:[^"]|"")*"/g)
    assert.equal(cells.length, 18)
    assert.equal(cells[0], '"UNOBSERVED_TEMPLATE_NOT_EVIDENCE"')
    assert.ok(['"plus"', '"dekamarkt"'].includes(cells[1]))
    assert.deepEqual(cells.slice(6), Array(12).fill('""'))
  }
  assert.match(result.csv, /"plus","chicken-thigh","Kippendij","600","g"/)
  assert.match(result.csv, /"dekamarkt","chicken-thigh","Kippendij","600","g"/)
  assert.doesNotMatch(result.csv, /sourceUrl|capturedAt|sha256|currentPrice|priceCents|https:\/\/|access_token|0\.85|publicSavingsClaimEligible/i)
  assert.deepEqual(records, before)
})

test('selected one-day and seven-day custom recipes change real aggregated human field requirements', async () => {
  const originals = await fixtures()
  const monday = buildPrivateSelectedWeekObservationWorksheet(originals, ['Ma'])
  assert.equal(monday.rows, 10)
  assert.match(monday.csv, /"plus","chicken-thigh","Kippendij","300","g"/)
  const customPlan = [...structuredClone(m2InitialPlan), { day: 'Vr', recipeId: 'tikka' }]
  const custom = buildPrivateSelectedWeekObservationWorksheet(originals, ['Ma','Do','Vr'], {
    plan: customPlan, recipes: structuredClone(m2Recipes),
  })
  assert.equal(custom.rows, 10)
  assert.match(custom.csv, /"plus","chicken-thigh","Kippendij","900","g"/)
  assert.match(custom.csv, /"dekamarkt","chicken-thigh","Kippendij","900","g"/)
  const reversed = buildPrivateSelectedWeekObservationWorksheet([...originals].reverse(), ['Vr', 'Do', 'Ma'], {
    plan: customPlan, recipes: structuredClone(m2Recipes),
  })
  assert.equal(reversed.csv, custom.csv)
})

test('CSV-formula labels are escaped, with no operator-entered cells prefilled', async () => {
  const originals = await fixtures()
  const recipes = structuredClone(m2Recipes)
  recipes[0].ingredients[0].label = '=HYPERLINK("https://bad.example","click")'
  const template = buildPrivateSelectedWeekObservationWorksheet(originals, ['Ma'], {
    plan: structuredClone(m2InitialPlan), recipes,
  })
  assert.doesNotMatch(template.csv, /,"=HYPERLINK/)
  assert.match(template.csv, /"'=HYPERLINK\(""https:\/\/bad\.example"",""click""\)"/)
  for (const row of rows(template.csv).slice(1)) {
    assert.equal(row.match(/"(?:[^"]|"")*"/g).length, 18)
  }
})

test('invalid plan or hostile argv fail closed without emitting partial output', async () => {
  const records = await fixtures()
  assert.throws(() => buildPrivateSelectedWeekObservationWorksheet(records.slice(0, 5), ['Ma']))
  assert.throws(() => buildPrivateSelectedWeekObservationWorksheet(records, ['Ma','Ma']))
  assert.throws(() => buildPrivateSelectedWeekObservationWorksheet(records, ['Vr']))
  let output = ''
  const done = await main(['--days','Ma,Do'], value => { output += value })
  assert.equal(done.rows, 10)
  assert.equal(output, buildPrivateSelectedWeekObservationWorksheet(records,['Ma','Do']).csv)
  for (const input of [['--days','Ma,Ma'], ['--days','Vr'], ['--output','/tmp/x'], ['--days','Ma, Do']]) {
    let partial = ''
    await assert.rejects(main(input, value => { partial += value }))
    assert.equal(partial, '')
  }
  let getterCalls = 0
  const hostile = new Proxy([], { get() { getterCalls++; throw Error('executed') } })
  await assert.rejects(main(hostile, () => { getterCalls++ }))
  assert.equal(getterCalls, 0)
})
