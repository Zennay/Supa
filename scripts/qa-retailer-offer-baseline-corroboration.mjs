/**
 * Independent OFFLINE offer/canonical catalog corroboration review.
 * A claimed markdown price is not a saving without the same retailer,
 * product, package, normal-price source and compatible observation clocks.
 * Reports only aggregate review counts. Never publishes current prices.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const fail = () => { throw new Error('Private retailer offer corroboration QA refused') }
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const validMoney = x => x === null || (Number.isSafeInteger(x) && x >= 0)
const hosts = { plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' }
const kinds = ['product', 'catalog', 'offers']
const pairs = Object.keys(hosts).flatMap(r => kinds.map(k => r + ':' + k))
const NS_PER_MS = 1_000_000n
const NS_PER_HOUR = 3_600_000_000_000n
// Store physical UTC instants as integer nanoseconds. Date.parse alone rounds
// away submillisecond source facts; lexical UTC offsets may refer to exactly
// the same capture and should not cause a false evidence rejection.
function instant(value, limit) {
  const fields = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null
  if (!fields) fail()
  const year = Number(fields[1])
  const month = Number(fields[2])
  const day = Number(fields[3])
  const civil = new Date(Date.UTC(year, month - 1, day))
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 ||
      civil.getUTCDate() !== day ||
      Number(fields[4]) > 23 || Number(fields[5]) > 59 ||
      Number(fields[6] ?? 0) > 59) fail()
  const zone = fields[8]
  if (zone !== 'Z') {
    const [hours, minutes] = zone.slice(1).split(':').map(Number)
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) fail()
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) fail()
  const fraction = (fields[7] ?? '').padEnd(9, '0')
  const ns = BigInt(ms) * NS_PER_MS + BigInt(fraction.slice(3) || '0')
  if (ns > limit) fail()
  return ns
}
function validOrigin(observation, key, asOf) {
  const [retailer, kind] = key.split(':')
  if (observation.supermarket !== retailer ||
      !object(observation.provenance) ||
      observation.provenance.supermarket !== retailer ||
      observation.provenance.kind !== kind) fail()
  const p = observation.provenance
  if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256) ||
      typeof p.url !== 'string' || p.url.length > 2048) fail()
  let url
  try { url = new URL(p.url) } catch { fail() }
  if (url.protocol !== 'https:' || url.hostname !== hosts[retailer] ||
      url.username || url.password || url.port || url.hash ||
      url.href !== p.url ||
      [...url.searchParams.keys()].some(k =>
        /(?:token|key|session|auth|secret|password)/i.test(k))) fail()
  return instant(p.capturedAt, asOf)
}
function keyOf(observation) {
  return observation.supermarket + ':' + observation.sourceProductId
}
// Compare actual physical quantities, never the retailer's display unit.
// Use exact, bounded milli-gram / micro-liter integer keys to avoid fuzzy
// matching. Unknown units or sub-resolution / unsafe numeric quantities
// remain incomparable instead of manufacturing offer corroboration.
function physicalPackKey(pack) {
  if (!object(pack) || typeof pack.amount !== 'number' ||
      !Number.isFinite(pack.amount) || pack.amount <= 0) return null
  const unit = pack.unit
  if (unit === 'piece' || unit === 'pack') {
    return unit + ':' + pack.amount
  }
  const dimension = unit === 'kg' || unit === 'g' ? 'mass' :
    unit === 'l' || unit === 'ml' ? 'volume' : null
  if (dimension === null) return null
  const scale = unit === 'kg' || unit === 'l' ? 1_000_000 : 1_000
  const scaled = pack.amount * scale
  const rounded = Math.round(scaled)
  if (!Number.isSafeInteger(rounded) || rounded <= 0 ||
      Math.abs(scaled - rounded) > 1e-8) return null
  return dimension + ':' + rounded
}
function samePack(a, b) {
  const left = physicalPackKey(a)
  return left !== null && left === physicalPackKey(b)
}
export function reviewPrivateRetailerOffers(batch, {
  asOf = new Date().toISOString(), windowHours = 24,
} = {}) {
  const asOfNs = instant(asOf, BigInt(Date.now()) * NS_PER_MS)
  if (!Number.isSafeInteger(windowHours) || windowHours < 1 ||
      windowHours > 720 ||
      !object(batch) || !object(batch.summary) ||
      batch.summary.mode !== 'reviewed-offline-only' ||
      batch.summary.productionEnabled !== false ||
      batch.summary.permissionVerified !== false ||
      batch.summary.publicSavingsClaimEligible !== false ||
      !object(batch.summary.retailerCounts) ||
      !Array.isArray(batch.results) || batch.results.length !== 6) fail()

  let observations = 0
  const retailerCounts = { plus: 0, dekamarkt: 0 }
  const actualKinds = new Set()
  const catalogs = new Map()
  const offers = []
  for (let i = 0; i < batch.results.length; i++) {
    if (!Object.hasOwn(batch.results, i)) fail()
    const result = batch.results[i]
    if (!object(result) || !pairs.includes(result.key) ||
        actualKinds.has(result.key) ||
        result.accepted !== true || result.reason !== null ||
        !Array.isArray(result.observations) ||
        !result.observations.length || result.observations.length > 256) fail()
    actualKinds.add(result.key)
    const [retailer] = result.key.split(':')
    let sameSnapshot = null
    const seenSku = new Set()
    for (let j = 0; j < result.observations.length; j++) {
      if (!Object.hasOwn(result.observations, j)) fail()
      const ob = result.observations[j]
      try { validateRawProductObservation(ob) } catch { fail() }
      if (typeof ob.sourceProductId !== 'string' ||
          !/^[a-zA-Z0-9._-]{1,160}$/.test(ob.sourceProductId) ||
          !validMoney(ob.currentPriceCents) ||
          (ob.offer && (!validMoney(ob.offer.offerPriceCents) ||
                        !validMoney(ob.offer.originalPriceCents)))) fail()
      const timestamp = validOrigin(ob, result.key, asOfNs)
      const identity = JSON.stringify([ob.provenance.url, ob.provenance.sha256,
                                       ob.provenance.capturedAt])
      if (sameSnapshot !== null && sameSnapshot !== identity) fail()
      sameSnapshot = identity
      if (seenSku.has(ob.sourceProductId)) fail()
      seenSku.add(ob.sourceProductId)
      observations++
      retailerCounts[retailer]++
      if (result.key.endsWith(':catalog')) {
        const list = catalogs.get(keyOf(ob)) ?? []
        list.push({ cents: ob.currentPriceCents, pack: ob.pack, timestamp })
        catalogs.set(keyOf(ob), list)
      }
      if (result.key.endsWith(':offers')) {
        offers.push({ ob, timestamp })
      }
    }
  }
  const s = batch.summary
  if (actualKinds.size !== pairs.length || s.sources !== 6 ||
      s.acceptedSources !== 6 || s.rejectedSources !== 0 ||
      s.observations !== observations ||
      s.retailerCounts.plus !== retailerCounts.plus ||
      s.retailerCounts.dekamarkt !== retailerCounts.dekamarkt) fail()

  const totals = {
    observedOfferRows: 0,
    priceBackedOfferRows: 0,
    corroboratedHistoricalBaselines: 0,
    missingCatalogBaselines: 0,
    conflictingCatalogBaselines: 0,
    incomparablePackages: 0,
    staleCrossChannelCaptures: 0,
    invalidDiscountClaims: 0,
    unknownOfferWindows: 0,
    outOfWindowAtCapture: 0,
  }
  for (const { ob, timestamp } of offers) {
    totals.observedOfferRows++
    const offer = ob.offer
    if (offer === null || offer.offerPriceCents === null ||
        offer.originalPriceCents === null ||
        ob.currentPriceCents === null) {
      totals.invalidDiscountClaims++
      continue
    }
    // A present offer is not a separate amount from its observed price.
    if (offer.offerPriceCents !== ob.currentPriceCents) fail()
    if (offer.originalPriceCents <= offer.offerPriceCents) {
      totals.invalidDiscountClaims++
      continue
    }
    totals.priceBackedOfferRows++
    // Validate EACH supplied boundary, including a partial/unknown window.
    // A normal upcoming campaign end can be later than the review clock;
    // reject implausibly distant dates, but do not label future expiry invalid.
    const campaignLimit = asOfNs + 366n * 24n * NS_PER_HOUR
    const start = offer.validFrom === null ? null : instant(offer.validFrom, campaignLimit)
    const end = offer.validTo === null ? null : instant(offer.validTo, campaignLimit)
    if (start === null || end === null) {
      totals.unknownOfferWindows++
    } else {
      if (start > end) fail()
      if (timestamp < start || timestamp > end) totals.outOfWindowAtCapture++
    }
    const baselines = catalogs.get(keyOf(ob))
    if (!baselines?.length) {
      totals.missingCatalogBaselines++
      continue
    }
    const packMatched = baselines.filter(row => samePack(row.pack, ob.pack))
    if (!packMatched.length) {
      totals.incomparablePackages++
      continue
    }
    const recent = packMatched.filter(row => {
      const diff = timestamp > row.timestamp ? timestamp - row.timestamp :
        row.timestamp - timestamp
      return diff <= BigInt(windowHours) * NS_PER_HOUR
    })
    if (!recent.length) {
      totals.staleCrossChannelCaptures++
      continue
    }
    if (recent.some(row =>
      row.cents !== offer.originalPriceCents || row.cents === null)) {
      totals.conflictingCatalogBaselines++
      continue
    }
    totals.corroboratedHistoricalBaselines++
  }
  return {
    schemaVersion: 1,
    mode: 'private-historical-retailer-offer-corroboration',
    sourceKinds: actualKinds.size,
    reviewedObservations: observations,
    captureWindowHours: windowHours,
    ...totals,
    needsHumanReview: true,
    historicalOnly: true,
    permissionVerified: false,
    productionEnabled: false,
    livePricesAvailable: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  }
}
export async function main(argv = process.argv.slice(2), emit = text => process.stdout.write(text)) {
  if (!Array.isArray(argv) || argv.length !== 0) fail()
  const batch = await loadReviewedRepositoryFixtures()
  const report = reviewPrivateRetailerOffers(batch)
  emit(JSON.stringify(report) + '\n')
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer offer corroboration QA refused')
    process.exitCode = 2
  })
}
