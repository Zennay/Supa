/**
 * Explicit opt-in civil-clock gate for the six archived PLUS/Deka retailer
 * shapes. M3 private/offline only; it does NOT modify existing adapter callers.
 *
 * The source adapters historically accepted UTC-13/-14 because they bounded
 * both signs to 14 hours. The civil range is asymmetric: UTC-12 to UTC+14.
 * We reject source clocks *before* invoking the ordinary batch engine.
 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { snapshotInertReviewedEvidence } from './retailer-inert-json-admission.mjs'
import {
  ingestReviewedBatch,
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from './retailer-reviewed-ingest-engine.mjs'

const fail = () => { throw new Error('Private retailer capture civil-clock preflight refused') }
const CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/
const KINDS = new Set(['plus:product', 'plus:catalog', 'plus:offers', 'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers'])

function leap(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Parse only physically possible four-digit Gregorian civil source clocks. */
export function isValidPrivateCivilCaptureTime(value, referenceTime = Date.now()) {
  if (typeof value !== 'string' || !Number.isSafeInteger(referenceTime)) return false
  const m = CLOCK.exec(value)
  if (!m) return false
  const [, yy, mo, dd, hh, mi, ss, fraction, zone, sign, oh, om] = m
  const year = Number(yy), month = Number(mo), day = Number(dd)
  const hour = Number(hh), minute = Number(mi), second = Number(ss)
  if (year < 1 || month < 1 || month > 12 ||
      day < 1 || day > DAYS[month - 1] + (month === 2 && leap(year) ? 1 : 0) ||
      hour > 23 || minute > 59 || second > 59) return false
  if (zone !== 'Z') {
    const offsetHour = Number(oh), offsetMinute = Number(om)
    if (offsetMinute > 59 || offsetHour > (sign === '-' ? 12 : 14) ||
        (offsetHour === (sign === '-' ? 12 : 14) && offsetMinute !== 0)) return false
  }
  // Date.parse truncates to milliseconds. Keep the remaining six digits so a
  // source captured even 1ns after the allowed physical cutoff cannot pass.
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  const remainingNs = BigInt((fraction ?? '').padEnd(9, '0').slice(3) || '0')
  const capturedNs = BigInt(timestamp) * 1_000_000n + remainingNs
  const latestNs = (BigInt(referenceTime) + 60_000n) * 1_000_000n
  return capturedNs <= latestNs
}

/**
 * Fail closed before ANY private batch prices/observations are calculated.
 * Clone the entire untrusted input via the already shared inert JSON boundary
 * before reading length, source properties, or user-supplied iterators.
 */
export function ingestCivilClockCheckedReviewedBatch(records) {
  if (arguments.length !== 1) fail()
  const now = Date.now()
  const copies = snapshotInertReviewedEvidence(records)
  if (!Array.isArray(copies) || copies.length < 1 || copies.length > 32) fail()
  for (const record of copies) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        !record.source || typeof record.source !== 'object' ||
        !KINDS.has(record.source.supermarket + ':' + record.source.kind) ||
        !isValidPrivateCivilCaptureTime(record.source.capturedAt, now)) fail()
  }
  const batch = ingestReviewedBatch(copies)
  // The plain engine supports partial review; this opt-in stricter gate never
  // returns a deceptively complete-looking partially admitted collection.
  if (batch.summary.rejectedSources !== 0 ||
      batch.summary.acceptedSources !== copies.length ||
      batch.summary.productionEnabled !== false ||
      batch.summary.permissionVerified !== false ||
      batch.summary.publicSavingsClaimEligible !== false) fail()
  return batch
}

/** Offline CLI: only six fixed, checked-in sanitized historical fixtures. */
export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || argv.length !== 0 || typeof write !== 'function') fail()
  const root = new URL('../fixtures/m1/', import.meta.url)
  const records = []
  for (const name of RETAILER_REVIEWED_FIXTURES) {
    records.push(await readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root))))
  }
  const { summary } = ingestCivilClockCheckedReviewedBatch(records)
  if (summary.acceptedSources !== 6 || summary.rejectedSources !== 0 ||
      summary.productionEnabled !== false || summary.permissionVerified !== false ||
      summary.publicSavingsClaimEligible !== false) fail()
  write(JSON.stringify({ ...summary, civilClockPreflight: true }, null, 2) + '\n')
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer capture civil-clock preflight refused')
    process.exitCode = 2
  })
}
