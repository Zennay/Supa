/** Blank M3 human observation CSV from actual selected planner demand, NOT retailer prices. */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { m2DefaultActiveDays } from '../src/data/m2Fixture.ts'
import { snapshotInertReviewedEvidence } from './retailer-inert-json-admission.mjs'
import { RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture } from './retailer-reviewed-ingest-engine.mjs'
import { buildCivilClockCheckedPrivatePlannedWeek } from './retailer-private-civil-week-bridge.mjs'

const STATUS = 'UNOBSERVED_TEMPLATE_NOT_EVIDENCE'
const HEADERS = [
  'evidenceStatus', 'retailerId', 'ingredientId', 'ingredientLabel',
  'requiredAmount', 'requiredUnit', 'observedAt', 'storeLocation',
  'priceContext', 'observedProductName', 'observedPackAmount',
  'observedPackUnit', 'observedPackCount', 'observedPriceEUR',
  'observedAvailability', 'collectionMethod', 'evidenceReference', 'notes',
]
const refuse = () => { throw Error('Private field worksheet refused') }
// Quote all cells; inert planner labels must never become spreadsheet formulas.
function cell(value) {
  let data = String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]/gu, ' ')
  if (/^\s*[=+\-@]/u.test(data)) data = "'" + data
  return '"' + data.replace(/"/g, '""') + '"'
}
const line = values => values.map(cell).join(',')

/**
 * Exact selected-day demand becomes a blank, paired PLUS/DekaMarkt worksheet.
 * Deliberately discard historical price, offer, product, URL and SHA evidence.
 * This DOES NOT satisfy the actual matched-observation proof gate.
 */
export function buildPrivateSelectedWeekObservationWorksheet(records, days = m2DefaultActiveDays, options) {
  if (arguments.length < 1 || arguments.length > 3) refuse()
  const { privateReview, summary } = buildCivilClockCheckedPrivatePlannedWeek(records, days, options)
  if (summary.productionReady !== false || summary.sourcePermissionVerified !== false ||
      summary.publicSavingsClaimEligible !== false || summary.externalRequests !== 0 ||
      privateReview.livePriceClaimsAllowed !== false ||
      summary.retailerReviewRows !== privateReview.preview.rows.length) refuse()
  const seen = new Set()
  const rows = privateReview.preview.rows.map(row => {
    if (!['plus', 'dekamarkt'].includes(row.retailerId) ||
        typeof row.ingredientId !== 'string' || !row.ingredientId ||
        typeof row.ingredientLabel !== 'string' || !row.ingredientLabel ||
        !Number.isFinite(row.required?.amount) || row.required.amount <= 0 ||
        typeof row.required.unit !== 'string' || !row.required.unit) refuse()
    const key = row.retailerId + ':' + row.ingredientId
    if (seen.has(key)) refuse()
    seen.add(key)
    return [STATUS, row.retailerId, row.ingredientId, row.ingredientLabel,
      row.required.amount, row.required.unit, ...Array(12).fill('')]
  })
  if (rows.length !== summary.ingredientNeeds * 2 ||
      rows.length !== summary.retailerReviewRows) refuse()
  return {
    evidenceStatus: 'collection-template-not-evidence',
    observedStorePrices: 0, rows: rows.length,
    productionReady: false, publicSavingsClaimEligible: false,
    csv: [line(HEADERS), ...rows.map(line)].join('\n') + '\n',
  }
}

/** Fixed historical sanitized archives only, stdout only; no paths/network. */
export async function main(argv = process.argv.slice(2), write = value => process.stdout.write(value)) {
  const values = snapshotInertReviewedEvidence(argv)
  if (!Array.isArray(values) || (values.length !== 0 &&
      (values.length !== 2 || values[0] !== '--days' || typeof values[1] !== 'string'))) refuse()
  const days = values.length ? values[1].split(',') : [...m2DefaultActiveDays]
  if (!days.length || days.length > m2DefaultActiveDays.length ||
      new Set(days).size !== days.length ||
      days.some(day => !m2DefaultActiveDays.includes(day))) refuse()
  if (typeof write !== 'function') refuse()
  const root = new URL('../fixtures/m1/', import.meta.url)
  const records = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(filename =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(filename, root)))))
  const result = buildPrivateSelectedWeekObservationWorksheet(records, days)
  write(result.csv)
  return { evidenceStatus: result.evidenceStatus, rows: result.rows, productionReady: false }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private field worksheet refused; no observed store prices created')
    process.exitCode = 2
  })
}
