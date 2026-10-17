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
