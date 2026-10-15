/**
 * Compare two aggregate-only offline adapter health reports.
 * A regression is in SUPA's reviewed dataset, never an assertion that a
 * retailer delisted a product or lost stock/changed public pricing.
 */
import { lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const STORES = ['plus', 'dekamarkt']
const KINDS = ['product', 'catalog', 'offers']
const KEYS = STORES.flatMap(store => KINDS.map(kind => store + ':' + kind))
const BUCKET = ['sources', 'accepted', 'rejected', 'observations', 'staleCaptures',
  'unknownPrices', 'unknownAvailability', 'unknownPacks', 'offerObservations']
const ACTIONS = ['review-missing-source-shapes', 'review-rejected-adapter-inputs',
  'review-capture-freshness', 'review-conflicting-product-facts',
  'review-missing-price-facts', 'obtain-written-retailer-source-rights',
  'collect-genuine-two-store-m3-basket-evidence']
const fail = () => { throw new Error('Private retailer health trend refused') }
const dict = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const exact = (x, keys) => dict(x) && Object.keys(x).length === keys.length &&
  keys.every(key => Object.hasOwn(x, key))
const safe = n => Number.isSafeInteger(n) && n >= 0 && n <= 50_000
const HEADER = ['schemaVersion','mode','meaning','sources','acceptedSources',
  'rejectedSources','observations','products','captureEvents','inconsistentProducts',
  'staleSources','unknownPriceObservations','maxAgeHours','byShape',
  'missingSourceKinds','sixShapeCoverageComplete','historicalFreshnessWithinWindow',
  'operatorActions','humanReviewRequired','permissionVerified','productionEnabled',
  'livePricesAvailable','publicSavingsClaimEligible','externalRequests']

function verified(report) {
  if (!exact(report, HEADER) || report.schemaVersion !== 1 ||
      report.mode !== 'private-reviewed-adapter-health' ||
      report.meaning !== 'offline-dataset-only' ||
      report.humanReviewRequired !== true ||
      report.permissionVerified !== false || report.productionEnabled !== false ||
      report.livePricesAvailable !== false ||
      report.publicSavingsClaimEligible !== false || report.externalRequests !== 0 ||
      !Number.isSafeInteger(report.maxAgeHours) ||
      report.maxAgeHours < 1 || report.maxAgeHours > 720 ||
      !exact(report.byShape, KEYS) ||
      !Array.isArray(report.missingSourceKinds) ||
      !Array.isArray(report.operatorActions) ||
      !safe(report.sources) || report.sources < 1 || report.sources > 32 ||
      !safe(report.acceptedSources) || !safe(report.rejectedSources) ||
      !safe(report.observations) || !safe(report.products) ||
      !safe(report.captureEvents) || !safe(report.inconsistentProducts) ||
      !safe(report.staleSources) || !safe(report.unknownPriceObservations) ||
      report.inconsistentProducts > report.products ||
      report.captureEvents < report.products ||
      report.unknownPriceObservations > report.observations) fail()
  const total = Object.fromEntries(BUCKET.map(key => [key, 0]))
  const missing = []
  for (const key of KEYS) {
    const bucket = report.byShape[key]
    if (!exact(bucket, BUCKET) || !BUCKET.every(field => safe(bucket[field])) ||
        bucket.sources !== bucket.accepted + bucket.rejected ||
        bucket.sources > 32 || bucket.staleCaptures > bucket.accepted ||
        bucket.unknownPrices > bucket.observations ||
        bucket.unknownAvailability > bucket.observations ||
        bucket.unknownPacks > bucket.observations ||
        bucket.offerObservations > bucket.observations) fail()
    for (const field of BUCKET) total[field] += bucket[field]
    if (bucket.accepted === 0) missing.push(key)
  }
  const expectedActions = [
    ...(missing.length ? [ACTIONS[0]] : []),
    ...(total.rejected ? [ACTIONS[1]] : []),
    ...(total.staleCaptures ? [ACTIONS[2]] : []),
    ...(report.inconsistentProducts ? [ACTIONS[3]] : []),
    ...(total.unknownPrices ? [ACTIONS[4]] : []),
    ACTIONS[5], ACTIONS[6],
  ]
  if (total.sources !== report.sources ||
      total.accepted !== report.acceptedSources ||
      total.rejected !== report.rejectedSources ||
      total.observations !== report.observations ||
      total.staleCaptures !== report.staleSources ||
      total.unknownPrices !== report.unknownPriceObservations ||
      report.sixShapeCoverageComplete !== (missing.length === 0 && total.rejected === 0) ||
      report.historicalFreshnessWithinWindow !== (total.staleCaptures === 0) ||
      JSON.stringify(report.missingSourceKinds) !== JSON.stringify(missing) ||
      JSON.stringify(report.operatorActions) !== JSON.stringify(expectedActions)) fail()
}

export function comparePrivateAdapterHealth(before, after) {
  verified(before)
  verified(after)
  // A changed age threshold changes the diagnostic's meaning.
  if (before.maxAgeHours !== after.maxAgeHours) fail()
  const changes = Object.fromEntries(KEYS.map(key => [key, {
    acceptedDelta: after.byShape[key].accepted - before.byShape[key].accepted,
    rejectedDelta: after.byShape[key].rejected - before.byShape[key].rejected,
    observationDelta: after.byShape[key].observations - before.byShape[key].observations,
    staleCaptureDelta: after.byShape[key].staleCaptures - before.byShape[key].staleCaptures,
    unknownPriceDelta: after.byShape[key].unknownPrices - before.byShape[key].unknownPrices,
  }]))
  const missingNew = after.missingSourceKinds.filter(key => !before.missingSourceKinds.includes(key))
  const recovered = before.missingSourceKinds.filter(key => !after.missingSourceKinds.includes(key))
  // Global totals may be unchanged when one reviewed retailer shape worsens
  // while another recovers. Treat that as an offline *dataset* regression, not
  // a claim about live stock, retailer behavior or publishable savings.
  // Only controlled aggregate signal labels leave this private comparison.
  const worsened = (field) => KEYS.some(key =>
    after.byShape[key][field] > before.byShape[key][field])
  const improvedAdmissionLoss = KEYS.some(key =>
    after.byShape[key].accepted < before.byShape[key].accepted)
  const worsenedRejection = KEYS.some(key =>
    after.byShape[key].rejected > before.byShape[key].rejected)
  const shapeSignals = [
    // A worse physical retailer source must not disappear when a different
    // source shape improves and keeps aggregate accepted/rejected totals flat.
    // Signals remain generic: no store, SKU, capture time or price leaves here.
    ...(improvedAdmissionLoss ? ['fewer-accepted-sources-in-source-shape'] : []),
    ...(worsenedRejection ? ['more-rejected-sources-in-source-shape'] : []),
    ...(worsened('staleCaptures') ? ['more-stale-captures-in-source-shape'] : []),
    ...(worsened('unknownPrices') ? ['more-unpriced-observations-in-source-shape'] : []),
    ...(worsened('unknownAvailability') ? ['more-unknown-availability-in-source-shape'] : []),
    ...(worsened('unknownPacks') ? ['more-unknown-packs-in-source-shape'] : []),
  ]
  const signals = [
    ...(missingNew.length ? ['new-missing-source-shape'] : []),
    ...(after.rejectedSources > before.rejectedSources ? ['more-rejected-source-shapes'] : []),
    ...(after.acceptedSources < before.acceptedSources ? ['fewer-accepted-sources'] : []),
    ...(after.staleSources > before.staleSources ? ['more-stale-captures'] : []),
    ...(after.inconsistentProducts > before.inconsistentProducts ? ['more-conflicted-products'] : []),
    ...(after.unknownPriceObservations > before.unknownPriceObservations
      ? ['more-unpriced-observations'] : []),
    ...shapeSignals,
  ]
  return {
    schemaVersion: 1, mode: 'private-adapter-health-trend',
    context: 'offline-reviewed-dataset-differences-only',
    maxAgeHours: before.maxAgeHours,
    totalObservationDelta: after.observations - before.observations,
    totalProductDelta: after.products - before.products,
    newlyMissingShapes: missingNew, recoveredShapes: recovered,
    perShape: changes,
    reviewSignals: signals,
    datasetRegressionSignalsDetected: signals.length > 0,
    humanReviewRequired: true, permissionVerified: false,
    productionEnabled: false, publicSavingsClaimEligible: false,
    livePricesAvailable: false, externalRequests: 0,
  }
}
// Private 0600 files still have an ambiguous meaning when object property
// names repeat: JSON.parse would silently choose the final permission or
// dataset count. Reject raw duplicates, including escaped equivalent keys,
// before any report is admitted. Never echo private JSON or paths in errors.
function parseUniqueReportJson(bytes) {
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const scopes = []
    for (let i = 0; i < raw.length;) {
      const ch = raw[i]
      if (ch === '{' || ch === '[') {
        if (scopes.length >= 128) fail()
        scopes.push(ch === '{' ? new Set() : null)
        i++
        continue
      }
      if (ch === '}' || ch === ']') {
        if (!scopes.length) fail()
        scopes.pop()
        i++
        continue
      }
      if (ch !== '"') { i++; continue }
      const start = i++
      while (i < raw.length) {
        if (raw[i] === '\\') { i += 2; continue }
        if (raw[i++] === '"') break
      }
      let next = i
      while (next < raw.length && (
        raw[next] === ' ' || raw.charCodeAt(next) === 9 ||
        raw.charCodeAt(next) === 10 || raw.charCodeAt(next) === 13)) next++
      const scope = scopes.at(-1)
      if (raw[next] === ':' && scope instanceof Set) {
        const name = JSON.parse(raw.slice(start, i))
        if (scope.has(name)) fail()
        scope.add(name)
      }
    }
    return JSON.parse(raw)
  } catch { fail() }
}
async function privateReport(name) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.length > 500 ||
      !/^[a-z0-9][a-z0-9_.-]*\.json$/i.test(basename(name))) fail()
  const path = resolve(name)
  const root = dirname(path)
  // Private reports must stay in an owner-only staging directory, matching
  // the private reviewed manifest builder/replay. A 0600 file alone does not
  // pin directory metadata or reject a group/world-writable staging root.
  async function privateAncestors() {
    let cur = path
    for (;;) {
      const stats = await lstat(cur)
      if (stats.isSymbolicLink() ||
          (cur === path && (!stats.isFile() || stats.nlink !== 1 ||
            (stats.mode & 0o077) !== 0 || stats.size > 65536)) ||
          (cur === root && (!stats.isDirectory() || (stats.mode & 0o077) !== 0))) fail()
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  }
  await privateAncestors()
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await fd.stat()
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o077) ||
        stats.size > 65536) fail()
    // Recheck after descriptor acquisition and before accepting evidence, so
    // a now-public directory is never silently reported as privately held.
    await privateAncestors()
    const bytes = await fd.readFile()
    if (bytes.length > 65536) fail()
    await privateAncestors()
    return parseUniqueReportJson(bytes)
  } finally { await fd.close() }
}
export async function main(argv = process.argv.slice(2), write = data => process.stdout.write(data)) {
  if (!Array.isArray(argv) || argv.length !== 4 ||
      argv[0] !== '--before' || argv[2] !== '--after' ||
      resolve(argv[1]) === resolve(argv[3])) fail()
  const report = comparePrivateAdapterHealth(
    await privateReport(argv[1]), await privateReport(argv[3]))
  write(JSON.stringify(report, null, 2) + '\n')
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Private retailer health trend refused'); process.exitCode = 2 })
}
