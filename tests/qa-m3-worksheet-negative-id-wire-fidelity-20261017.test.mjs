/**
 * Independent M3 operator CSV QA: visible literal ingredientId cells must be
 * paired byte-for-byte between PLUS and Deka; a spreadsheet-safe leading
 * apostrophe may only be the canonical producer representation, not an alias
 * that permits mixed visible identifiers. No observed prices/rights claims.
 *
 * Frozen scanner owner #3724; one new test-only file. Expected RED until
 * scanner owner makes safe negative IDs and paired canonical IDs consistent.
 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { auditPrivateWorksheetCsv, main } from '../scripts/qa-m3-private-worksheet-preflight.mjs'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture }
  from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet }
  from '../scripts/retailer-private-selected-week-observation.mjs'


const headers = [
  'evidenceStatus', 'retailerId', 'ingredientId', 'ingredientLabel',
  'requiredAmount', 'requiredUnit', 'observedAt', 'storeLocation',
  'priceContext', 'observedProductName', 'observedPackAmount',
  'observedPackUnit', 'observedPackCount', 'observedPriceEUR',
  'observedAvailability', 'collectionMethod', 'evidenceReference', 'notes',
]
const cell = value => '"' + value.replaceAll('"', '""') + '"'
const row = values => values.map(cell).join(',')
const pairedCsv = (idPlus, idDeka) => [
  row(headers),
  row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', 'plus', idPlus,
    'Kaas 🧀', '125', 'g', ...Array(12).fill('')]),
  row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', 'dekamarkt', idDeka,
    'Kaas 🧀', '125', 'g', ...Array(12).fill('')]),
].join('\n') + '\n'
const blankPrivate = {
  mode: 'm3-blank-worksheet-qa-only',
  rows: 2, ingredientNeeds: 1, pairedRetailers: 2,
  verifiedActualObservations: 0, sourceRightsVerified: false,
  productionReady: false, publicSavingsClaimEligible: false,
}

async function refusesWithoutLeaks(csv) {
  const writes = []
  assert.throws(() => auditPrivateWorksheetCsv(csv),
    /Private worksheet QA audit refused/)
  await assert.rejects(main(Readable.from([Buffer.from(csv, 'utf8')]),
    chunk => writes.push(chunk)), /Private worksheet QA audit refused/)
  assert.deepEqual(writes, [], 'source IDs and empty observation columns may not escape on refusal')
}

test('control: exact canonical apostrophe-prefixed negative ID and normal IDs remain valid', async () => {
  for (const id of ["'-milk", 'milk', 'milk-bottle', 'abc:milk_10']) {
    const csv = pairedCsv(id, id)
    assert.deepEqual(auditPrivateWorksheetCsv(csv), blankPrivate)
    const output = []
    assert.deepEqual(await main(Readable.from([Buffer.from(csv)]),
      chunk => output.push(chunk)), blankPrivate)
    assert.deepEqual(output, [JSON.stringify(blankPrivate) + '\n'])
    assert.doesNotMatch(output[0], /Kaas|milk|dekamarkt|plus|observedPriceEUR/)
  }
})

test('control: genuinely distinct negative IDs cannot be paired by the private scanner', async () => {
  for (const [a, b] of [
    ["'-milk", "'-cream"], ["'-milk", "'-milk2"], ['milk', "''-milk"],
    ['-milk', '-cream'],
  ]) await refusesWithoutLeaks(pairedCsv(a, b))
})

test('P2 expected RED: plus escaped negative ID and Deka bare negative ID must NOT match', async () => {
  await refusesWithoutLeaks(pairedCsv("'-milk", '-milk'))
})

test('P2 expected RED: Deka escaped negative ID and PLUS bare negative ID must NOT match', async () => {
  await refusesWithoutLeaks(pairedCsv('-milk', "'-milk"))
})

test('P2 expected RED: bare negative ID in both stores is noncanonical and must be refused', async () => {
  await refusesWithoutLeaks(pairedCsv('-milk', '-milk'))
})

// Reproduce against the real offline producer and original six checked-in
// sanitized reviewed archives. None are live/current prices or field proof.
async function realEmptyMondaySheet() {
  const archived = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL('../fixtures/m1/' + name,
      import.meta.url)))))
  const archivedCopy = structuredClone(archived)
  const recipes = structuredClone(m2Recipes)
  recipes.find(recipe => recipe.id === 'tikka').ingredients[0].id = '-milk'
  const plan = structuredClone(m2InitialPlan)
  const sourceCopy = structuredClone({recipes, plan})
  const sheet = buildPrivateSelectedWeekObservationWorksheet(archived, ['Ma'], {plan, recipes})
  assert.deepEqual(archived, archivedCopy, 'actual sanitized archives remain immutable')
  assert.deepEqual({recipes, plan}, sourceCopy, 'original private plan data remain immutable')
  assert.equal(sheet.productionReady, false)
  assert.equal(sheet.publicSavingsClaimEligible, false)
  assert.equal(sheet.observedStorePrices, 0)
  assert.equal(sheet.rows, 10)
  return sheet
}

test('control: original six checked-in archives produce exactly escaped source ID in both real M3 store rows', async () => {
  const sheet = await realEmptyMondaySheet()
  const matches = sheet.csv.split('\n').filter(line => line.includes('"\'-milk"'))
  assert.equal(matches.length, 2)
  assert.ok(matches.some(line => line.includes('"plus","\'-milk"')))
  assert.ok(matches.some(line => line.includes('"dekamarkt","\'-milk"')))
  assert.equal(auditPrivateWorksheetCsv(sheet.csv).rows, 10)
})

test('P2 expected RED: changing only Deka raw ID to unescaped in true 5×2 worksheet is not a valid paired field template', async () => {
  const sheet = await realEmptyMondaySheet()
  const modified = sheet.csv.replace('"dekamarkt","\'-milk"', '"dekamarkt","-milk"')
  assert.notEqual(modified, sheet.csv, 'mutate exactly one retailer row from genuine offline exporter')
  await refusesWithoutLeaks(modified)
})

test('control: original source-safe negative IDs remain legitimate through exact 170-character boundary', async () => {
  const safe = ['-x', '-X', '-a_b.1:2', '-'+ 'a'.repeat(169)]
  for (const sourceId of safe) {
    const visible = "'" + sourceId
    const csv = pairedCsv(visible, visible)
    assert.deepEqual(auditPrivateWorksheetCsv(csv), blankPrivate)
    const output = []
    assert.deepEqual(await main(Readable.from([Buffer.from(csv)]), fragment => output.push(fragment)), blankPrivate)
    assert.deepEqual(output, [JSON.stringify(blankPrivate) + '\n'])
    assert.doesNotMatch(output[0], /dekamarkt|plus|Kaas/)
  }
  await refusesWithoutLeaks(pairedCsv("'-" + 'a'.repeat(170), "'-" + 'a'.repeat(170)))
})
