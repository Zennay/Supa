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
    if (typeof source.url !== 'string' || source.url.length < 9 ||
        source.url.length > 2048 || !source.url.startsWith('https://')) fail()
    if (typeof source.capturedAt !== 'string' || source.capturedAt.length > 64 ||
        !Number.isFinite(Date.parse(source.capturedAt))) fail()
    if (typeof source.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(source.sha256)) fail()

    const logicalKey = JSON.stringify([key, source.id])
    // Source.id is deliberately excluded: it is mutable and does not establish
    // that the reviewed HTML bytes were captured independently a second time.
    const physicalKey = JSON.stringify([
      key, record.evidenceType, source.url, source.capturedAt, source.sha256,
    ])
    // An identical immutable page/timestamp/hash is one physical capture,
    // even if a caller also relabels the retailer, adapter kind or type.
    const rawCaptureKey = JSON.stringify([source.url, source.capturedAt, source.sha256])
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
