/**
 * Independent M3 QA: UTF-8 BOM should be refused consistently by the direct
 * scanner, bounded stdin preflight and CLI. Synthetic unobserved paired rows;
 * no real prices, source permissions, public savings or product source edits.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { auditPrivateWorksheetCsv, main } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

const columns = [
  'evidenceStatus', 'retailerId', 'ingredientId', 'ingredientLabel',
  'requiredAmount', 'requiredUnit', 'observedAt', 'storeLocation',
  'priceContext', 'observedProductName', 'observedPackAmount',
  'observedPackUnit', 'observedPackCount', 'observedPriceEUR',
  'observedAvailability', 'collectionMethod', 'evidenceReference', 'notes',
]
const q = str => '"' + str.replaceAll('"', '""') + '"'
const row = cells => cells.map(q).join(',')
const csv = [row(columns), ...['plus', 'dekamarkt'].map(store =>
  row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', store, 'safe-one',
    'Zuurdesem 👩‍🍳', '12.5', 'g', ...Array(12).fill('')]))].join('\n') + '\n'
const bytes = Buffer.from(csv, 'utf8')
const bom = Buffer.from([0xef, 0xbb, 0xbf])
const prefixed = Buffer.concat([bom, bytes])
const expected = {
  mode: 'm3-blank-worksheet-qa-only', rows: 2, ingredientNeeds: 1,
  pairedRetailers: 2, verifiedActualObservations: 0,
  sourceRightsVerified: false, productionReady: false,
  publicSavingsClaimEligible: false,
}
const cli = fileURLToPath(new URL('../scripts/qa-m3-private-worksheet-preflight.mjs', import.meta.url))

test('control: canonical no-BOM CSV stays private and valid in all three entry points', async () => {
  assert.deepEqual(auditPrivateWorksheetCsv(csv), expected)
  let written = ''
  assert.deepEqual(await main(Readable.from([bytes]), chunk => { written += chunk }), expected)
  assert.deepEqual(JSON.parse(written), expected)
  const got = spawnSync(process.execPath, [cli], { input: bytes, encoding: 'utf8', timeout: 10000 })
  assert.equal(got.status, 0, got.stderr)
  assert.deepEqual(JSON.parse(got.stdout), expected)
  assert.equal(got.stderr, '')
  assert.doesNotMatch(got.stdout, /Zuurdesem|dekamarkt|plus/)
})

test('control: direct string parser refuses leading U+FEFF before quoted header', () => {
  assert.throws(() => auditPrivateWorksheetCsv('\ufeff' + csv), /Private worksheet QA audit refused/)
  assert.throws(() => auditPrivateWorksheetCsv('\ufeff\ufeff' + csv), /Private worksheet QA audit refused/)
})

test('P2 expected RED: BOM bytes must not silently turn into a valid streaming worksheet', async () => {
  for (const parts of [
    [prefixed],
    [prefixed.subarray(0, 1), prefixed.subarray(1, 2), prefixed.subarray(2)],
    [bom, bytes],
  ]) {
    const writes = []
    await assert.rejects(main(Readable.from(parts), chunk => writes.push(chunk)),
      /Private worksheet QA audit refused/)
    assert.deepEqual(writes, [], 'noncanonical input must not emit an operator summary')
  }
})

test('P2 expected RED: BOM stdin CLI refuses with no stdout and no human label leak', () => {
  const got = spawnSync(process.execPath, [cli], { input: prefixed, encoding: 'utf8', timeout: 10000 })
  assert.equal(got.status, 2, 'noncanonical BOM wire should be refused, not normalized')
  assert.equal(got.stdout, '')
  assert.match(got.stderr, /^Private worksheet QA audit refused\s*$/)
  assert.doesNotMatch(got.stderr, /Zuurdesem|dekamarkt|plus/)
})
