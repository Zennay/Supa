/**
 * Private-only historical retailer fact-change overview.
 * Consumes independently validated offline adapter batches, never network,
 * scraped content, a price feed, or an eligible public savings claim.
 *
 * Each (retailer, source kind, source product ID) is compared at its latest
 * physical captured instant. The report intentionally contains only counts.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { evaluatePrivateAdapterHealth } from './retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const PAIRS = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const fail = () => { throw new Error('Private retailer fact change review refused') }
const ZERO = () => ({
  previousProducts: 0, currentProducts: 0, added: 0, missing: 0,
  priceChanged: 0, offerChanged: 0, packChanged: 0,
  availabilityChanged: 0, nameChanged: 0, sourceUrlChanged: 0,
  unchanged: 0,
})
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 128

function instantNanos(iso) {
  if (typeof iso !== 'string') fail()
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(iso)
  if (!m) fail()
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((x,i) =>
    i === 5 ? Number(x ?? '0') : Number(x))
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59 ||
      (m[8] !== 'Z' && (Number(m[10]) > 14 || Number(m[11]) > 59 ||
        (Number(m[10]) === 14 && Number(m[11]) !== 0)))) fail()
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) fail()
  return BigInt(ms) * 1_000_000n +
    BigInt((m[7] ?? '').padEnd(9, '0').slice(3) || '0')
}

function normalized(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number' ||
      typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(normalized).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + normalized(value[key])).join(',') + '}'
  }
  fail()
}

function physicalProductFacts(observation) {
  // One immutable HTML body at one URL cannot produce different product
  // facts merely because its archived capture timestamp is expressed later.
  // Exclude provenance time here; SHA/URL continuity is checked separately.
  return normalized({
    supermarket: observation.supermarket,
    sourceProductId: observation.sourceProductId,
    name: observation.name,
    currentPriceCents: observation.currentPriceCents,
    currency: observation.currency,
    pack: observation.pack,
    offer: observation.offer,
    availability: observation.availability,
  })
}

/**
 * SHA-256 covers the whole raw retailer page, not only products whose IDs
 * happen to match in two reports. A catalog parser cannot invent, rename or
 * drop an SKU while reusing the same raw URL+SHA at another capture time.
 *
 * Group cards by physical capture event first (a four-card HTML page is ONE
 * event); then compare complete identity+fact sets for every repeated raw
 * URL+SHA, including within a single historical batch.
 */
function assertImmutableSourceProductSets(previous, current) {
  const signatures = new Map()
  for (const batch of [previous, current]) {
    const events = new Map()
    for (const result of batch.results) {
      if (!result.accepted) continue
      if (!PAIRS.includes(result.key)) fail()
      for (const obs of result.observations) {
        if (!safeId(obs.sourceProductId)) fail()
        const source = obs.provenance
        const pageKey = JSON.stringify([result.key, source.url, source.sha256])
        const timestamp = instantNanos(source.capturedAt).toString()
        let timeline = events.get(pageKey)
        if (!timeline) {
          timeline = new Map()
          events.set(pageKey, timeline)
        }
        let identities = timeline.get(timestamp)
        if (!identities) {
          identities = new Map()
          timeline.set(timestamp, identities)
        }
        const product = physicalProductFacts(obs)
        const seen = identities.get(obs.sourceProductId)
        if (seen !== undefined && seen !== product) fail()
        identities.set(obs.sourceProductId, product)
      }
    }
    for (const [pageKey, timeline] of events) {
      for (const identities of timeline.values()) {
        const signature = JSON.stringify([...identities.entries()]
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
        const earlier = signatures.get(pageKey)
        if (earlier !== undefined && earlier !== signature) fail()
        signatures.set(pageKey, signature)
      }
    }
  }
}

/**
 * Capture order belongs to a physical retailer source page, not to an SKU.
 * Catalogs can replace every product identifier between two revisions.
 * Compare the most recent event per (retailer, source kind, URL) first so an
 * older archive cannot masquerade as new additions and removals.
 *
 * Use the original nanosecond-aware clock parser: Date.parse alone loses
 * submillisecond ordering. Distinct URLs are not interchangeable evidence.
 */
function latestSourceCaptureEvents(batch) {
  const events = new Map()
  for (const result of batch.results) {
    if (!result.accepted) continue
    if (!PAIRS.includes(result.key)) fail()
    for (const observation of result.observations) {
      const source = observation.provenance
      const page = JSON.stringify([result.key, source.url])
      const capture = { when: instantNanos(source.capturedAt), sha: source.sha256 }
      const previous = events.get(page)
      if (!previous || previous.when < capture.when) {
        events.set(page, capture)
      } else if (previous.when === capture.when && previous.sha !== capture.sha) {
        // One page at one physical instant cannot have two raw HTML bodies.
        fail()
      }
    }
  }
  return events
}

function latest(batch) {
  const rows = new Map()
  for (const result of batch.results) {
    if (!result.accepted) continue
    if (!PAIRS.includes(result.key)) fail()
    for (const observation of result.observations) {
      if (!safeId(observation.sourceProductId)) fail()
      const id = result.key + '\u0000' + observation.sourceProductId
      const when = instantNanos(observation.provenance.capturedAt)
      const value = {
        when, sha: observation.provenance.sha256, url: observation.provenance.url,
        obs: observation,
      }
      const old = rows.get(id)
      if (!old || old.when < when) rows.set(id, value)
      else if (old.when === when &&
          (old.sha !== value.sha || old.url !== value.url ||
            normalized(old.obs) !== normalized(observation))) {
        // A capture at the same physical instant cannot simultaneously give
        // incompatible identity/price facts under a single comparable key.
        fail()
      }
    }
  }
  return rows
}

/**
 * Both batches must pass the existing exhaustive six-adapter health review
 * first. No caller can turn old observations into licensed/current prices by
 * supplying a different flag, timestamp spelling, or altered summary count.
 */
export function comparePrivateRetailerFactChanges(previous, current, {
  referenceTime = new Date().toISOString(),
} = {}) {
  const before = evaluatePrivateAdapterHealth(previous, { referenceTime })
  const after = evaluatePrivateAdapterHealth(current, { referenceTime })
  // A rejected source or missing adapter cannot establish product absence.
  // Never count incomplete coverage as deletion or a store delisting.
  if (before.productionEnabled !== false || after.productionEnabled !== false ||
      before.permissionVerified !== false || after.permissionVerified !== false ||
      before.externalRequests !== 0 || after.externalRequests !== 0 ||
      before.sixShapeCoverageComplete !== true ||
      after.sixShapeCoverageComplete !== true ||
      before.rejectedSources !== 0 || after.rejectedSources !== 0) fail()
  assertImmutableSourceProductSets(previous, current)
  const oldCaptures = latestSourceCaptureEvents(previous)
  const newCaptures = latestSourceCaptureEvents(current)
  for (const [page, old] of oldCaptures) {
    const next = newCaptures.get(page)
    if (!next) continue // A genuinely different page has no shared timeline.
    if (next.when < old.when ||
        (next.when === old.when && next.sha !== old.sha)) fail()
  }
  const oldRows = latest(previous)
  const newRows = latest(current)
  const perShape = Object.fromEntries(PAIRS.map(x => [x, ZERO()]))
  let comparisons = 0
  const all = new Set([...oldRows.keys(), ...newRows.keys()])
  for (const id of all) {
    const key = id.slice(0, id.indexOf('\u0000'))
    const count = perShape[key]
    if (!count) fail()
    const old = oldRows.get(id), next = newRows.get(id)
    if (old) count.previousProducts++
    if (next) count.currentProducts++
    if (!old) { count.added++; continue }
    if (!next) { count.missing++; continue }
    if (next.when < old.when) fail()
    if (next.when === old.when &&
        (next.sha !== old.sha || next.url !== old.url ||
          normalized(next.obs) !== normalized(old.obs))) fail()
    // SHA-256 identifies the same source bytes. Different prices, promotions,
    // packaging or stock with an unchanged SHA/URL are impossible evidence,
    // even when a later time is recorded for the same underlying HTML.
    if (next.sha === old.sha && next.url === old.url &&
        physicalProductFacts(old.obs) !== physicalProductFacts(next.obs)) fail()
    comparisons++
    const a = old.obs, b = next.obs
    const changed = [
      ['priceChanged', a.currentPriceCents, b.currentPriceCents],
      ['offerChanged', a.offer, b.offer],
      ['packChanged', a.pack, b.pack],
      ['availabilityChanged', a.availability, b.availability],
      ['nameChanged', a.name, b.name],
      ['sourceUrlChanged', old.url, next.url],
    ].map(([field, left, right]) => {
      const different = normalized(left) !== normalized(right)
      if (different) count[field]++
      return different
    }).some(Boolean)
    if (!changed) count.unchanged++
  }
  const total = ZERO()
  for (const values of Object.values(perShape)) {
    for (const key of Object.keys(total)) total[key] += values[key]
  }
  return {
    schemaVersion: 1, mode: 'private-historical-retailer-fact-change-review',
    comparedProducts: comparisons, previousCaptureEvents: before.captureEvents,
    currentCaptureEvents: after.captureEvents, perShape, totals: total,
    humanReviewRequired: true, historicalOnly: true,
    sourceRightsVerified: false, livePricesAvailable: false,
    publicSavingsClaimEligible: false, productionEnabled: false,
    externalRequests: 0,
  }
}

export async function main(argv = process.argv.slice(2),
  write = text => process.stdout.write(text)) {
  // No arbitrary files, URLs, or silently relabelled fresh snapshots.
  if (!Array.isArray(argv) || argv.length !== 0) fail()
  const archived = await loadReviewedRepositoryFixtures()
  const result = comparePrivateRetailerFactChanges(archived, archived)
  write(JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Private retailer fact change review refused'); process.exitCode = 2 })
}
