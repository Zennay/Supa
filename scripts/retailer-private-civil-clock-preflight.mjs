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
import { isValidCivilCaptureAt as isValidPrivateCivilCaptureTime, civilCaptureInstantKey } from '../src/data/retailerCivilCaptureClock.ts'
export { isValidPrivateCivilCaptureTime }
import {
  ingestReviewedBatch,
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from './retailer-reviewed-ingest-engine.mjs'

const fail = () => { throw new Error('Private retailer capture civil-clock preflight refused') }
const KINDS = new Set(['plus:product', 'plus:catalog', 'plus:offers', 'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers'])

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
  // ID aliases and physically equivalent timezone spellings must never count
  // one archived source twice. The same capture is identified by retailer,
  // shape, exact archived URL + SHA and its physical nanosecond UTC instant,
  // NOT the arbitrary record.source.id or textual clock offset.
  const physicalIdentities = new Set()
  for (const record of copies) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        !record.source || typeof record.source !== 'object' ||
        !KINDS.has(record.source.supermarket + ':' + record.source.kind) ||
        typeof record.source.url !== 'string' ||
        typeof record.source.sha256 !== 'string' ||
        !isValidPrivateCivilCaptureTime(record.source.capturedAt, now)) fail()
    const instant = civilCaptureInstantKey(record.source.capturedAt, now)
    if (instant === null) fail()
    const identity = JSON.stringify([
      record.source.supermarket, record.source.kind,
      record.source.url, record.source.sha256, instant,
    ])
    if (physicalIdentities.has(identity)) fail()
    physicalIdentities.add(identity)
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
