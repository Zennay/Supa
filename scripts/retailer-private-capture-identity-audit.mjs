/**
 * Private M3 review aid: a source ID is an application label, NOT a unique
 * physical capture. An immutable retailer URL/time/hash fingerprint is.
 *
 * This independent, additive audit does not change the ingestion engine's
 * admission rules, nor authorize retailer reuse, publishing, or a saving claim.
 * Ingestion owner remains responsible for integrating the gate upstream.
 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { snapshotInertReviewedEvidence } from './retailer-inert-json-admission.mjs'
import {
  readBoundedRegularReviewedFixture,
  RETAILER_REVIEWED_FIXTURES,
  ingestReviewedBatch,
} from './retailer-reviewed-ingest-engine.mjs'

const APPROVED = Object.freeze({
  'plus:product': 'plus-browser-rendered-schema-org-product',
  'plus:catalog': 'plus-browser-rendered-catalog',
  'plus:offers': 'plus-browser-rendered-offers',
  'dekamarkt:product': 'dekamarkt-public-ssr-nuxt-product',
  'dekamarkt:catalog': 'dekamarkt-public-ssr-nuxt-catalog',
  'dekamarkt:offers': 'dekamarkt-public-ssr-nuxt-offers',
})

const fail = () => { throw new Error('Invalid private retailer capture identity') }
const isPlain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value)

// Reject impossible civil days/offsets instead of accepting Date.parse rollover.
// Canonicalize UTC instants at up to nanosecond precision: 18:00Z and
// 20:00+02:00 are one physical capture, but a 1ns-later capture is distinct.
function canonicalCaptureNanoseconds(raw) {
  if (typeof raw !== 'string' || raw.length > 64) fail()
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(raw)
  if (!m) fail()
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6])
  if (year < 1970 || month < 1 || month > 12 ||
      day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      hour > 23 || minute > 59 || second > 59) fail()
  let offsetMinutes = 0
  if (m[8] !== 'Z') {
    const offsetHours = Number(m[10])
    const offsetRemainder = Number(m[11])
    if (offsetHours > 14 || offsetRemainder > 59 ||
        (offsetHours === 14 && offsetRemainder !== 0)) fail()
    offsetMinutes = (m[9] === '+' ? 1 : -1) * (offsetHours * 60 + offsetRemainder)
  }
  const fractional = (m[7] || '').padEnd(9, '0')
  const millis = Date.UTC(year, month - 1, day, hour, minute, second,
    Number(fractional.slice(0, 3))) - offsetMinutes * 60_000
  if (!Number.isFinite(millis)) fail()
  const nanos = BigInt(millis) * 1_000_000n + BigInt(fractional.slice(3))
  if (nanos > BigInt(Date.now() + 60_000) * 1_000_000n) fail()
  return nanos.toString()
}

// This audit is for the six reviewed retailer evidence shapes, not arbitrary
// URLs. An HTTPS prefix is insufficient proof of retailer origin or article.
function assertApprovedReviewUrl(source) {
  const raw = source.url
  if (typeof raw !== 'string' || raw.length < 9 || raw.length > 2048 ||
      /[?#]/.test(raw)) fail()
  let url
  try { url = new URL(raw) } catch { fail() }
  const expectedHost = source.supermarket === 'plus' ? 'www.plus.nl' : 'www.dekamarkt.nl'
  if (!url || url.href !== raw || url.protocol !== 'https:' ||
      url.hostname !== expectedHost || url.username || url.password ||
      url.port || url.search || url.hash) fail()
  const path = url.pathname
  const allowed = source.kind === 'product'
    ? (source.supermarket === 'plus' ? /^\/product\/[^/].*$/ : /^\/producten\/[^/].*$/)
    : source.kind === 'catalog'
      ? /^\/producten(?:\/.*)?$/
      : /^\/aanbiedingen(?:\/.*)?$/
  if (!allowed.test(path)) fail()
}

export function auditPhysicalRetailerCaptures(input) {
  // Snapshot BEFORE reading any caller property or array iterator: no getters,
  // custom prototypes, accessors, Proxies, toJSON, or circular source objects.
  const records = snapshotInertReviewedEvidence(input)
  if (!Array.isArray(records) || records.length < 1 || records.length > 32) fail()

  const physical = new Set()
  const rawCapture = new Set()
  const logical = new Set()
  const counts = { plus: 0, dekamarkt: 0 }
  for (const record of records) {
    if (!isPlain(record) || !isPlain(record.source) || record.version !== 1) fail()
    const source = record.source
    if (typeof source.supermarket !== 'string' || typeof source.kind !== 'string') fail()
    const key = source.supermarket + ':' + source.kind
    if (!Object.hasOwn(APPROVED, key) || APPROVED[key] !== record.evidenceType) fail()
    if (typeof source.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(source.id)) fail()
    assertApprovedReviewUrl(source)
    const canonicalCaptureClock = canonicalCaptureNanoseconds(source.capturedAt)
    if (typeof source.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(source.sha256)) fail()

    const logicalKey = JSON.stringify([key, source.id])
    // Source.id is deliberately excluded: it is mutable and does not establish
    // that the reviewed HTML bytes were captured independently a second time.
    const physicalKey = JSON.stringify([
      key, record.evidenceType, source.url, canonicalCaptureClock, source.sha256,
    ])
    // An identical immutable page/timestamp/hash is one physical capture,
    // even if a caller also relabels the retailer, adapter kind or type.
    const rawCaptureKey = JSON.stringify([source.url, canonicalCaptureClock, source.sha256])
    if (physical.has(physicalKey) || rawCapture.has(rawCaptureKey) || logical.has(logicalKey)) {
      throw new Error('Duplicate physical or labeled reviewed capture')
    }
    rawCapture.add(rawCaptureKey)
    physical.add(physicalKey)
    logical.add(logicalKey)
    counts[source.supermarket]++
  }
  return Object.freeze({
    mode: 'private-offline-capture-identity-audit',
    reviewedSources: records.length,
    uniquePhysicalCaptures: physical.size,
    retailerSourceCounts: Object.freeze(counts),
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
  })
}

/**
 * Opt-in safe private ingest adapter. Does not alter legacy
 * ingestReviewedBatch; callers must explicitly use this entrypoint.
 * Physical and logical aliases fail before engine ingestion can count them.
 */
export function ingestPhysicallyDistinctReviewedBatch(records) {
  auditPhysicalRetailerCaptures(records)
  return ingestReviewedBatch(records)
}

export async function auditBundledHistoricalRetailerCaptures() {
  // Only fixed reviewed repository fixtures, never caller-chosen file paths,
  // live retailer URLs, proxies, or public user input.
  const base = new URL('../fixtures/m1/', import.meta.url)
  const records = []
  for (const file of RETAILER_REVIEWED_FIXTURES) {
    records.push(await readBoundedRegularReviewedFixture(fileURLToPath(new URL(file, base))))
  }
  return auditPhysicalRetailerCaptures(records)
}

export async function main(args = process.argv.slice(2), output = text => process.stdout.write(text)) {
  // The exported CLI handler may be called by another JS module. Verify its
  // argument array is inert before even consulting .length or any index.
  args = snapshotInertReviewedEvidence(args)
  if (!Array.isArray(args) || args.length !== 0) {
    throw new Error('Usage: node --experimental-strip-types scripts/retailer-private-capture-identity-audit.mjs')
  }
  const report = await auditBundledHistoricalRetailerCaptures()
  output(JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Private capture identity audit refused; nothing was published')
    process.exitCode = 2
  })
}
