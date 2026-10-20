/**
 * Private offline QA admission for reviewed retailer capture events.
 * The same physical event may be replayed idempotently, but cannot acquire
 * different products, cents, offers, packs or availability without a new
 * captured timestamp, URL or SHA. Never fetch, license or publish prices.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'

const STORES = { plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' }
const KINDS = new Set(['product', 'catalog', 'offers'])
const FAIL = 'Private retailer event consistency QA refused'
const fail = () => { throw new Error(FAIL) }
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const safe = v => v === null || (Number.isSafeInteger(v) && v >= 0)
const count = v => Number.isSafeInteger(v) && v >= 0
// Match the reviewed product adapters' accepted ISO times, while comparing
// absolute nanosecond instants (Date.parse alone truncates beyond 3 digits).
// Different representations of one capture instant are ONE physical event.
function instant(value, cutoffNs) {
  if (typeof value !== 'string') fail()
  const fields = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!fields) fail()
  const year = Number(fields[1]), month = Number(fields[2]), day = Number(fields[3])
  const dayCheck = new Date(Date.UTC(year, month - 1, day))
  if (dayCheck.getUTCFullYear() !== year ||
      dayCheck.getUTCMonth() !== month - 1 ||
      dayCheck.getUTCDate() !== day ||
      Number(fields[4]) > 23 || Number(fields[5]) > 59 ||
      Number(fields[6] ?? 0) > 59) fail()
  const offset = fields[8]
  if (offset !== 'Z') {
    const [hours, minutes] = offset.slice(1).split(':').map(Number)
    if (hours > 23 || minutes > 59) fail()
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) fail()
  const fraction = (fields[7] ?? '').padEnd(9, '0')
  const ns = BigInt(ms) * 1_000_000n + BigInt(fraction.slice(3) || '0')
  if (ns > cutoffNs) fail()
  return ns
}
function origin(value, retailer, kind, clock) {
  if (!object(value) || value.supermarket !== retailer ||
      value.kind !== kind || typeof value.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.url !== 'string' || value.url.length > 2048) fail()
  let url
  try { url = new URL(value.url) } catch { fail() }
  if (url.protocol !== 'https:' || url.hostname !== STORES[retailer] ||
      url.username || url.password || url.port || url.hash ||
      url.href !== value.url ||
      [...url.searchParams.keys()].some(key =>
        /(?:token|secret|key|session|auth|password|credential)/i.test(key))) fail()
  const capturedInstantNs = instant(value.capturedAt, clock)
  return JSON.stringify([retailer, kind, value.url, capturedInstantNs.toString(), value.sha256])
}
function facts(value) {
  return JSON.stringify([
    value.name, value.currentPriceCents, value.currency,
    value.pack.rawText, value.pack.amount, value.pack.unit,
    value.availability, value.offer === null ? null : [
      value.offer.label, value.offer.mechanics, value.offer.offerPriceCents,
      value.offer.originalPriceCents, value.offer.validFrom, value.offer.validTo,
    ],
  ])
}
/**
 * Accepts only existing in-memory reviewed-adapter output. A successful
 * review is historical dataset consistency, not real-time price permission.
 */
export function auditPrivateRetailerCaptureEvents(batch, { asOf = new Date().toISOString() } = {}) {
  const clock = instant(asOf, BigInt(Date.now()) * 1_000_000n)
  if (!object(batch) || !object(batch.summary) ||
      batch.summary.mode !== 'reviewed-offline-only' ||
      batch.summary.productionEnabled !== false ||
      batch.summary.permissionVerified !== false ||
      batch.summary.publicSavingsClaimEligible !== false ||
      !object(batch.summary.retailerCounts) ||
      !Array.isArray(batch.results) || batch.results.length < 1 ||
      batch.results.length > 32) fail()

  const events = new Map()
  let observations = 0
  const byStore = { plus: 0, dekamarkt: 0 }
  const identities = new Set()
  for (let i = 0; i < batch.results.length; i++) {
    if (!Object.hasOwn(batch.results, i)) fail()
    const result = batch.results[i]
    if (!object(result) || !result.accepted || result.reason !== null ||
        typeof result.key !== 'string' ||
        !Array.isArray(result.observations) ||
        result.observations.length < 1 || result.observations.length > 256) fail()
    const [retailer, kind] = result.key.split(':')
    if (!Object.hasOwn(STORES, retailer) || !KINDS.has(kind) ||
        result.key !== retailer + ':' + kind) fail()
    const productSet = new Map()
    let eventKey = null
    for (let j = 0; j < result.observations.length; j++) {
      if (!Object.hasOwn(result.observations, j)) fail()
      const value = result.observations[j]
      try { validateRawProductObservation(value) } catch { fail() }
      if (value.supermarket !== retailer ||
          typeof value.sourceProductId !== 'string' ||
          !/^[A-Za-z0-9._-]{1,160}$/.test(value.sourceProductId) ||
          !safe(value.currentPriceCents) || !object(value.pack) ||
          (value.pack.amount !== null && !(value.pack.amount > 0 && value.pack.amount < 1e12)) ||
          (value.pack.rawText !== null && value.pack.rawText.length > 256) ||
          (value.offer !== null &&
           (!safe(value.offer.offerPriceCents) ||
            !safe(value.offer.originalPriceCents)))) fail()
      const event = origin(value.provenance, retailer, kind, clock)
      if (eventKey !== null && eventKey !== event) fail()
      eventKey = event
      if (productSet.has(value.sourceProductId)) fail()
      productSet.set(value.sourceProductId, facts(value))
      byStore[retailer]++
      observations++
      identities.add(retailer + ':' + value.sourceProductId)
    }
    // Same SHA/URL/time/kind is the same physical source event. It cannot
    // yield a different product subset or changed facts on a later replay.
    const old = events.get(eventKey)
    if (old !== undefined) {
      if (old.size !== productSet.size) fail()
      for (const [sku, signature] of productSet) {
        if (old.get(sku) !== signature) fail()
      }
    } else {
      events.set(eventKey, productSet)
    }
  }
  const s = batch.summary
  if (s.sources !== batch.results.length ||
      s.acceptedSources !== batch.results.length ||
      s.rejectedSources !== 0 || s.observations !== observations ||
      !count(s.retailerCounts.plus) || !count(s.retailerCounts.dekamarkt) ||
      s.retailerCounts.plus !== byStore.plus ||
      s.retailerCounts.dekamarkt !== byStore.dekamarkt) fail()

  // Compare the independent provenance partition to the actual canonical
  // projection. No price selection or product matching across retailers.
  let catalog
  try { catalog = buildUniversalRetailerCatalog(batch) } catch { fail() }
  if (catalog.status !== 'private-review-only' ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false ||
      catalog.productCount !== identities.size ||
      catalog.products.some(item =>
        item.publishable !== false || item.sourceRightsVerified !== false ||
        item.currentTrustedPriceCents !== null)) fail()
  const duplicateSourceReplays = batch.results.length - events.size
  return {
    mode: 'offline-reviewed-retailer-event-integrity-qa',
    sourceResults: batch.results.length,
    distinctPhysicalEvents: events.size,
    idempotentEventReplays: duplicateSourceReplays,
    reviewedObservations: observations,
    retailerScopedProducts: identities.size,
    conflictsNeedingHumanReview: catalog.conflictCount,
    historicalOnly: true,
    permissionVerified: false,
    productionEnabled: false,
    livePricesAvailable: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  }
}
export async function main(args = process.argv.slice(2), write = value => process.stdout.write(value)) {
  if (!Array.isArray(args) || args.length !== 0) fail()
  const batch = await loadReviewedRepositoryFixtures()
  const summary = auditPrivateRetailerCaptureEvents(batch)
  write(JSON.stringify(summary) + '\n')
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(FAIL)
    process.exitCode = 2
  })
}
