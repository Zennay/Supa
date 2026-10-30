/** Offline 0600 HTML+manifest replay. No HTTP, rights grant or publication. */
import { createHash } from 'node:crypto'
import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'
import { readAuthorizedHtmlScriptEvidence } from './retailer-approved-html-script-evidence.mjs'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { corroborateDekaNuxtProduct } from './retailer-approved-deka-nuxt-product.mjs'
import { proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'
import { compareOfflineSelectorProposals } from './retailer-private-selector-drift.mjs'

const LIMIT = 2 * 1024 * 1024
const HOST = Object.freeze({ plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' })
const CAPTURE_ROUTES = Object.freeze({
  plus: { product: '/product/', catalog: '/producten', offers: '/aanbiedingen' },
  dekamarkt: { product: '/producten/', catalog: '/producten/', offers: '/aanbiedingen' },
})
function allowedCaptureRoute(source, url) {
  const prefix = CAPTURE_ROUTES[source.retailerId]?.[source.kind]
  if (!prefix) return false
  return prefix.endsWith('/') ? url.pathname.startsWith(prefix) &&
    (source.kind !== 'product' || url.pathname.length > prefix.length) :
    url.pathname === prefix || url.pathname.startsWith(prefix + '/')
}

const fail = () => { throw Error('Private source replay refused: untrusted HTML or manifest') }
async function privateBytes(path, size) {
  await assertNoSymlinkedM3OutputParents(path)
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      (parent.mode & 0o077) !== 0) fail()
  // No path-based read after checking metadata: a replaced symlink must not
  // redirect the read to an unrelated source. Validate the opened inode.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW |
    constants.O_NONBLOCK)
  try {
    const meta = await handle.stat()
    if (!meta.isFile() || meta.nlink !== 1 ||
        (meta.mode & 0o077) !== 0 ||
        meta.size <= 0 || meta.size > size) fail()
    const bytes = await handle.readFile()
    if (bytes.length !== meta.size || bytes.length > size) fail()
    return bytes
  } finally {
    await handle.close()
  }
}
function admitManifest(record) {
  if (!record || record.schemaVersion !== 1 ||
      record.recordType !== 'one-page-private-html-capture' ||
      record.status !== 'private-review-required' ||
      record.selectorReviewComplete !== false || record.releaseReady !== false ||
      record.publicSavingsClaimEligible !== false ||
      !record.source || !Object.hasOwn(HOST, record.source.retailerId) ||
      !Object.hasOwn(CAPTURE_ROUTES[record.source.retailerId], record.source.kind) ||
      typeof record.source.url !== 'string' ||
      typeof record.source.capturedAt !== 'string' ||
      typeof record.source.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.source.sha256) ||
      !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > LIMIT) fail()
  const src = record.source
  let url
  try { url = new URL(src.url) } catch { fail() }
  if (url.href !== src.url || url.protocol !== 'https:' ||
      url.hostname !== HOST[src.retailerId] || url.port || url.search || url.hash ||
      url.username || url.password ||
      !allowedCaptureRoute(src, url)) fail()
  const ms = Date.parse(src.capturedAt)
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(src.capturedAt) ||
      !Number.isFinite(ms) || new Date(ms).toISOString() !== src.capturedAt ||
      ms > Date.now() + 60_000) fail()
  return src
}

/** Original privately captured HTML and its immutable SHA-bound manifest only. */
async function readPrivateCapture(filename) {
  if (typeof filename !== 'string' || !filename.endsWith('.html') ||
      filename.length > 512 || filename.trim() !== filename) fail()
  const path = resolve(filename)
  const rawManifest = new TextDecoder('utf-8', { fatal: true })
    .decode(await privateBytes(path + '.manifest.json', 32_768))
  let manifest
  try { manifest = JSON.parse(rawManifest) } catch { fail() }
  // The approved capture downloader writes this exact canonical serialization.
  // Reject duplicate JSON keys, ambiguous escaped keys and arbitrary rewrites.
  if (rawManifest !== JSON.stringify(manifest, null, 2) + '\n') fail()
  const src = admitManifest(manifest)
  const bytes = await privateBytes(path, LIMIT)
  if (bytes.length !== manifest.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== src.sha256) fail()
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const provenance = { supermarket: src.retailerId, kind: src.kind,
    url: src.url, capturedAt: src.capturedAt, sha256: src.sha256 }
  return { html, src, provenance }
}

/** Existing private product capture only: no HTTP, production price or permission grant. */
export async function replayPrivateProductHtmlSnapshot(filename) {
  const { html, src, provenance } = await readPrivateCapture(filename)
  if (src.kind !== 'product') fail()
  const scripts = readAuthorizedHtmlScriptEvidence(html)
  if (scripts.invalid || scripts.jsonLdBlocks.length > 16) fail()
  let parsed = parseSchemaOrgProductForPage(scripts.jsonLdBlocks, provenance)
  if (src.retailerId === 'dekamarkt') {
    parsed = corroborateDekaNuxtProduct({
      html, provenance, jsonLdBlocks: scripts.jsonLdBlocks,
      structured: parsed, nuxtPresent: scripts.nuxtPayload !== null,
    })
  }
  const selectors = proposeOfflineRetailerSelectors({
    html, origin: { retailerId: src.retailerId, url: src.url, capturedAt: src.capturedAt },
  })
  if (selectors.source.sha256 !== src.sha256) fail()
  const price = parsed.type === 'observation' ? parsed.observation : null
  const maxCandidateAgeMs = 24 * 60 * 60 * 1000
  const freshEnoughForPriceReview = Date.now() - Date.parse(src.capturedAt) <= maxCandidateAgeMs
  const invalidPackOrPrice = !price || !Number.isSafeInteger(price.currentPriceCents) ||
    price.currentPriceCents <= 0 || price.pack.amount === null ||
    ['unknown', 'pack'].includes(price.pack.unit)
  // Non-sensitive operator diagnoses: no product names, prices, HTML or URLs.
  const reviewReason = !freshEnoughForPriceReview ? 'stale_capture'
    : !price ? 'missing_or_conflicting_product_evidence'
    : price.availability !== 'available' ? 'availability_unconfirmed'
    : invalidPackOrPrice ? 'price_or_physical_pack_missing'
    : null
  const plausible = reviewReason === null
  return {
    schemaVersion: 1, mode: 'offline-private-product-review',
    // Pin the actual product URL without returning or logging that private URL.
    // Drift between two unrelated SKUs is not a real selector regression.
    source: { retailerId: src.retailerId, capturedAt: src.capturedAt,
      sha256: src.sha256,
      productUrlSha256: createHash('sha256').update(src.url).digest('hex') },
    status: plausible ? 'candidate_for_human_review' : 'unverified_product',
    reviewReason,
    observation: plausible ? price : null,
    selectorProposals: selectors.selectors,
    selectorSnapshot: selectors, selectorReviewRequired: true,
    permissionVerifiedForThisReplay: false, sourceRightsForPublicationVerified: false,
    verifiedCurrentCheckoutPrice: false, readyForIngestion: false,
    publicSavingsClaimEligible: false, productionEnabled: false, published: false,
  }
}

/**
 * Product-independent selector discovery for already archived catalog/search
 * and offer pages. This NEVER parses a displayed price into a product quote.
 */
export async function replayPrivateSelectorHtmlSnapshot(filename, includePrivateCoverage = false) {
  const { html, src } = await readPrivateCapture(filename)
  if (!['catalog', 'offers'].includes(src.kind)) fail()
  const proposals = proposeOfflineRetailerSelectors({
    html, origin: {
      retailerId: src.retailerId, url: src.url, capturedAt: src.capturedAt,
    },
  }, includePrivateCoverage)
  if (proposals.source.sha256 !== src.sha256) fail()
  return {
    schemaVersion: 1, mode: 'offline-private-catalog-offer-selector-review',
    status: 'human-selector-review-required',
    source: { retailerId: src.retailerId, kind: src.kind,
      capturedAt: src.capturedAt, sha256: src.sha256,
      sourceUrlSha256: createHash('sha256').update(src.url).digest('hex') },
    proposals, humanReviewRequired: true, automatedSelectorPromotion: false,
    priceExtractionEnabled: false, readyForIngestion: false,
    permissionVerifiedForThisReplay: false, sourceRightsForPublicationVerified: false,
    publicSavingsClaimEligible: false, productionEnabled: false, published: false,
  }
}

async function inspectPrivateSelectorChange(beforeFile, afterFile) {
  const before = await replayPrivateSelectorHtmlSnapshot(beforeFile)
  const after = await replayPrivateSelectorHtmlSnapshot(afterFile)
  if (before.source.kind !== after.source.kind ||
      before.source.sourceUrlSha256 !== after.source.sourceUrlSha256) fail()
  return { before, after,
    alert: compareOfflineSelectorProposals(before.proposals, after.proposals) }
}

export async function comparePrivateSelectorHtmlSnapshots(beforeFile, afterFile) {
  return (await inspectPrivateSelectorChange(beforeFile, afterFile)).alert
}

export async function savePrivateSelectorDriftReview(beforeFile, afterFile, reviewFile) {
  const { before, after, alert } = await inspectPrivateSelectorChange(beforeFile, afterFile)
  return writePrivateReviewRecord({
    schemaVersion: 1, mode: 'private-catalog-offer-selector-drift-review',
    status: 'human-review-required',
    source: { retailerId: before.source.retailerId, kind: before.source.kind,
      sourceUrlSha256: before.source.sourceUrlSha256 },
    before: { capturedAt: before.source.capturedAt, sha256: before.source.sha256 },
    after: { capturedAt: after.source.capturedAt, sha256: after.source.sha256 },
    alert, humanReviewRequired: true, automatedSelectorPromotion: false,
    priceExtractionEnabled: false, readyForIngestion: false,
    sourceRightsForPublicationVerified: false, productionEnabled: false,
    publicSavingsClaimEligible: false, published: false,
  }, reviewFile)
}

export async function savePrivateSelectorHtmlReview(htmlFile, reviewFile) {
  return writePrivateReviewRecord(await replayPrivateSelectorHtmlSnapshot(htmlFile),
    reviewFile)
}

/**
 * Cross-snapshot selector stability for ONE retailer and page kind. Each input
 * must be an independently SHA-bound original private catalog/offer capture.
 * Stable selectors are evidence-backed proposals, never approved selectors.
 */
export async function savePrivateSelectorStabilityArchive(htmlFiles, reviewFile) {
  const { types: nodeTypes } = await import('node:util')
  if (nodeTypes.isProxy(htmlFiles) || !Array.isArray(htmlFiles) ||
      Object.getPrototypeOf(htmlFiles) !== Array.prototype ||
      htmlFiles.length < 2 || htmlFiles.length > 8) fail()
  const descriptors = Object.getOwnPropertyDescriptors(htmlFiles)
  if (Reflect.ownKeys(descriptors).length !== htmlFiles.length + 1) fail()
  const reports = []
  const unique = new Set()
  let retailerId = null, kind = null
  for (let i = 0; i < htmlFiles.length; i++) {
    const d = descriptors[i]
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string') fail()
    const report = await replayPrivateSelectorHtmlSnapshot(d.value, true)
    // A top-24 report cannot prove absence or frequency of candidates that
    // were pruned. Refuse a misleading cross-page stability assessment.
    if (report.proposals.candidateLimitReached ||
        !Number.isSafeInteger(report.proposals.selectorCandidatesOmitted) ||
        report.proposals.selectorCandidatesOmitted !== 0) fail()
    if (retailerId === null) { retailerId = report.source.retailerId; kind = report.source.kind }
    if (report.source.retailerId !== retailerId || report.source.kind !== kind ||
        unique.has(report.source.sha256)) fail()
    unique.add(report.source.sha256)
    reports.push(report)
  }
  const counts = new Map()
  const portable = new Map()
  for (const report of reports) {
    const seen = new Set()
    const seenClasses = new Set()
    for (const row of report.proposals.selectors) {
      const key = row.field + '\u0000' + row.selector
      if (seen.has(key)) continue
      seen.add(key)
      const found = counts.get(key)
      if (found) {
        found.observedInSnapshots++
        found.minMatchesPerSnapshot = Math.min(found.minMatchesPerSnapshot, row.instances)
        found.maxMatchesPerSnapshot = Math.max(found.maxMatchesPerSnapshot, row.instances)
      } else counts.set(key, {field:row.field, selector:row.selector,
        observedInSnapshots:1, minMatchesPerSnapshot:row.instances,
        maxMatchesPerSnapshot:row.instances, status:'needs-human-review'})
      // Stable class/data-testid/itemprop tokens can survive DOM tag changes.
      // Normalize only tokens OBSERVED in each actual snapshot; these hints
      // remain private, human-reviewed and never auto-applied.
      const classToken = /^[a-z][a-z0-9-]*\.([a-z][a-z0-9_-]{1,59})$/i.exec(row.selector)?.[1]
      const attribute = /^[a-z][a-z0-9-]*\[(data-testid|itemprop)="([a-z][a-z0-9_-]{1,59})"\]$/i.exec(row.selector)
      const token = classToken ? '.'+classToken : attribute
        ? '['+attribute[1]+'="'+attribute[2]+'"]' : null
      if (token) {
        const normalized = row.field + '\u0000' + token
        if (!seenClasses.has(normalized)) {
          seenClasses.add(normalized)
          const existing = portable.get(normalized)
          if (existing) existing.observedInSnapshots++
          else portable.set(normalized,{field:row.field, selector:token,
            observedInSnapshots:1, status:'needs-human-review',
            derivedFromActualHtmlTokens:true})
        }
      }
    }
  }
  const stablePortable = [...portable.values()].filter(x =>
    x.observedInSnapshots === reports.length).sort((a,b) =>
    a.field.localeCompare(b.field) || a.selector.localeCompare(b.selector))
  const all = [...counts.values()].sort((a,b) =>
    a.field.localeCompare(b.field) || a.selector.localeCompare(b.selector))
  const stable = all.filter(row => row.observedInSnapshots === reports.length)
  const unstable = all.filter(row => row.observedInSnapshots !== reports.length)
  // Coverage records facts rather than inventing missing CSS selectors.
  const fieldCoverage = Object.fromEntries([
    'product','name','price','pack','offer','availability',
  ].map(field => [field, {
    observedCandidates:all.filter(x => x.field === field).length,
    stableCandidates:stable.filter(x => x.field === field).length,
  }]))
  const saved = await writePrivateReviewRecord({
    schemaVersion:1, mode:'offline-private-selector-stability',
    status:'human-selector-review-required', retailerId, kind,
    samples:reports.map(x => ({capturedAt:x.source.capturedAt,
      sha256:x.source.sha256, sourceUrlSha256:x.source.sourceUrlSha256})),
    sampleCount:reports.length, stableCandidateCount:stable.length,
    unstableCandidateCount:unstable.length, stableCandidates:stable,
    unstableCandidates:unstable, fieldCoverage,
    stablePortableTokenCandidates:stablePortable,
    stablePortableTokenCandidateCount:stablePortable.length,
    humanReviewRequired:true, automatedSelectorPromotion:false,
    readyForIngestion:false, sourceRightsForPublicationVerified:false,
    priceExtractionEnabled:false, publicSavingsClaimEligible:false,
    productionEnabled:false, published:false,
  }, reviewFile)
  // No raw selectors or source URLs in CLI/stdout/API return.
  return {...saved, sampleCount:reports.length, stableCandidateCount:stable.length,
    unstableCandidateCount:unstable.length,
    stablePortableTokenCandidateCount:stablePortable.length}
}

/**
 * Compare two independently SHA-verified original private HTML snapshots;
 * returns count-only selector drift, never proposed names, HTML or prices.
 */
async function inspectPrivateSnapshotDrift(beforeHtml, afterHtml) {
  const before = await replayPrivateProductHtmlSnapshot(beforeHtml)
  const after = await replayPrivateProductHtmlSnapshot(afterHtml)
  if (before.source.productUrlSha256 !== after.source.productUrlSha256) fail()
  const selectors = compareOfflineSelectorProposals(
    before.selectorSnapshot, after.selectorSnapshot)
  const left = before.observation
  const right = after.observation
  const identitiesComparable = !!(left && right &&
    left.supermarket === right.supermarket &&
    left.sourceProductId === right.sourceProductId &&
    left.name === right.name && left.currency === right.currency)
  const packComparable = identitiesComparable &&
    left.pack.amount !== null && right.pack.amount !== null &&
    left.pack.unit !== 'unknown' && right.pack.unit !== 'unknown'
  // Count-only changes; never expose private prices or silently turn
  // missing evidence into a fake zero-price change.
  const report = {
    ...selectors,
    privateProductEvidence: {
      identityChangedCount: left && right && (
        left.sourceProductId !== right.sourceProductId ||
        left.name !== right.name) ? 1 : 0,
      priceChangeCount: identitiesComparable &&
        left.currentPriceCents !== null && right.currentPriceCents !== null
        ? Number(left.currentPriceCents !== right.currentPriceCents) : null,
      packChangeCount: packComparable
        ? Number(left.pack.amount !== right.pack.amount ||
            left.pack.unit !== right.pack.unit) : null,
      availabilityChangeCount: identitiesComparable
        ? Number(left.availability !== right.availability) : null,
      humanReviewRequired: true,
      currentCheckoutVerified: false,
    },
  }
  return { before, after, report }
}

export async function compareArchivedPrivateProductSnapshots(beforeHtml, afterHtml) {
  return (await inspectPrivateSnapshotDrift(beforeHtml, afterHtml)).report
}

/**
 * Durable private operator review. Never changes the canonical price store,
 * source-permission register, scheduler or any public output.
 */
async function writePrivateReviewRecord(record, reviewFile) {
  if (typeof reviewFile !== 'string' || reviewFile.length > 512 ||
      reviewFile.trim() !== reviewFile) fail()
  const target = resolve(reviewFile)
  const { basename, dirname } = await import('node:path')
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}\.json$/i.test(basename(target))) fail()
  await assertNoSymlinkedM3OutputParents(target)
  const { open, lstat, rm } = await import('node:fs/promises')
  const dir = await lstat(dirname(target))
  if (!dir.isDirectory() || dir.isSymbolicLink() ||
      (dir.mode & 0o077) !== 0) fail()
  const archiveBytes = JSON.stringify(record, null, 2) + '\n'
  const archiveSha256 = createHash('sha256').update(archiveBytes, 'utf8').digest('hex')
  let file, created = false, originalInode = null
  try {
    file = await open(target, 'wx', 0o600)
    created = true
    originalInode = await file.stat()
    await file.writeFile(archiveBytes, 'utf8')
    await file.chmod(0o600)
    await file.sync()
    await file.close()
    file = null
  } catch {
    if (file) await file.close().catch(() => {})
    if (created) {
      try {
        await assertNoSymlinkedM3OutputParents(target)
        const current = await lstat(target)
        // An alternate writer may replace the name after our exclusive open:
        // never delete that writer's file on a failed write/close.
        if (originalInode && current.isFile() && !current.isSymbolicLink() &&
            current.dev === originalInode.dev && current.ino === originalInode.ino)
          await rm(target)
      } catch { /* refuse unsafe cleanup */ }
    }
    fail()
  }
  // Operator can independently hash the private file to verify durability.
  // Its content never enters stdout; only the SHA-256 receipt is returned.
  return { created: true, status: record.status, humanReviewRequired: true,
    archiveSha256, published: false, productionEnabled: false }
}

export async function savePrivateOfflineProductReview(htmlFile, reviewFile) {
  return writePrivateReviewRecord(await replayPrivateProductHtmlSnapshot(htmlFile),
    reviewFile)
}

/**
 * Save a traceable but still non-authoritative selector/price-change alert.
 * Only source fingerprints, clock, HTML digests and aggregate change counts
 * go into the private 0600 record. No product prices or source URLs.
 */
export async function savePrivateOfflineDriftReview(beforeHtml, afterHtml, reviewFile) {
  const { before, after, report } =
    await inspectPrivateSnapshotDrift(beforeHtml, afterHtml)
  return writePrivateReviewRecord({
    schemaVersion: 1, mode: 'private-offline-selector-drift-review',
    status: 'human-review-required',
    retailerId: before.source.retailerId,
    productUrlSha256: before.source.productUrlSha256,
    before: { sha256: before.source.sha256, capturedAt: before.source.capturedAt },
    after: { sha256: after.source.sha256, capturedAt: after.source.capturedAt },
    alert: report,
    humanReviewRequired: true,
    readyForIngestion: false, permissionVerifiedForThisReplay: false,
    sourceRightsForPublicationVerified: false, verifiedCurrentCheckoutPrice: false,
    publicSavingsClaimEligible: false, productionEnabled: false, published: false,
  }, reviewFile)
}

/**
 * Offline operator batch: up to 22 independently pinned archived pages.
 * Prevent a duplicate SKU counting twice; no automatic price selection.
 */
export async function savePrivateOfflineReviewBatch(htmlFiles, reviewFile) {
  const { types: nodeTypes } = await import('node:util')
  if (nodeTypes.isProxy(htmlFiles) || !Array.isArray(htmlFiles) ||
      Object.getPrototypeOf(htmlFiles) !== Array.prototype ||
      htmlFiles.length < 1 || htmlFiles.length > 22) fail()
  const descriptors = Object.getOwnPropertyDescriptors(htmlFiles)
  if (Reflect.ownKeys(descriptors).length !== htmlFiles.length + 1) fail()
  const records = []
  const seen = new Set()
  for (let index = 0; index < htmlFiles.length; index++) {
    if (!descriptors[index] || !Object.hasOwn(descriptors[index], 'value') ||
        typeof descriptors[index].value !== 'string') fail()
    const record = await replayPrivateProductHtmlSnapshot(descriptors[index].value)
    const identity = record.source.retailerId + ':' + record.source.productUrlSha256
    if (seen.has(identity)) fail()
    seen.add(identity)
    records.push(record)
  }
  const retailerCounts = Object.fromEntries(['plus', 'dekamarkt'].map(store => [
    store, {
      candidates: records.filter(x => x.source.retailerId === store &&
        x.status === 'candidate_for_human_review').length,
      unverified: records.filter(x => x.source.retailerId === store &&
        x.status === 'unverified_product').length,
    },
  ]))
  const reviewReasonCounts = Object.fromEntries([
    'stale_capture', 'missing_or_conflicting_product_evidence',
    'availability_unconfirmed', 'price_or_physical_pack_missing',
  ].map(reason => [reason, records.filter(x => x.reviewReason === reason).length]))
  const saved = await writePrivateReviewRecord({
    schemaVersion: 1, mode: 'offline-private-product-review-batch',
    status: 'private-batch-needs-review',
    count: records.length,
    candidateCount: records.filter(x => x.status === 'candidate_for_human_review').length,
    unverifiedCount: records.filter(x => x.status === 'unverified_product').length,
    entries: records, retailerCounts, reviewReasonCounts, humanReviewRequired: true,
    sourceRightsForPublicationVerified: false, verifiedCurrentCheckoutPrices: 0,
    productionEnabled: false, published: false, publicSavingsClaimEligible: false,
  }, reviewFile)
  return { ...saved, count: records.length,
    candidateCount: records.filter(x => x.status === 'candidate_for_human_review').length,
    unverifiedCount: records.filter(x => x.status === 'unverified_product').length,
    retailerCounts, reviewReasonCounts }
}

// Operator CLI: no network and no source URL, price, HTML or private path stdout.
const { pathToFileURL } = await import('node:url')
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length === 4 && args[0] === '--selector-drift-save') {
    savePrivateSelectorDriftReview(args[1], args[2], args[3])
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(() => {
        console.error('Private catalog/offer selector drift archive refused')
        process.exitCode = 2
      })
  } else if (args[0] === '--selector-stability' && args.length >= 4 && args.length <= 10) {
    savePrivateSelectorStabilityArchive(args.slice(2), args[1])
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(() => {
        console.error('Private offline selector stability review refused')
        process.exitCode = 2
      })
  } else if (args.length === 3 && args[0] === '--selectors') {
    savePrivateSelectorHtmlReview(args[1], args[2])
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(() => {
        console.error('Private offline catalog/offer selector review refused')
        process.exitCode = 2
      })
  } else if (args.length === 3 && args[0] === '--selector-drift') {
    comparePrivateSelectorHtmlSnapshots(args[1], args[2])
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(() => {
        console.error('Private offline catalog/offer selector drift refused')
        process.exitCode = 2
      })
  } else if (args.length === 4 && args[0] === '--drift-save') {
    savePrivateOfflineDriftReview(args[1], args[2], args[3])
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(() => {
        console.error('Private offline drift archive refused; no data published')
        process.exitCode = 2
      })
  } else if (args[0] === '--batch' && args.length >= 3 && args.length <= 24) {
    savePrivateOfflineReviewBatch(args.slice(2), args[1])
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(() => {
        console.error('Private offline review batch refused; no price was published')
        process.exitCode = 2
      })
  } else if (args.length === 3 && args[0] === '--drift') {
    compareArchivedPrivateProductSnapshots(args[1], args[2])
      .then(report => process.stdout.write(JSON.stringify(report) + '\n'))
      .catch(() => {
        console.error('Private offline selector drift refused; no data was published')
        process.exitCode = 2
      })
  } else if (args.length === 2) {
    savePrivateOfflineProductReview(args[0], args[1])
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(() => {
        console.error('Private offline source review refused; no price was published')
        process.exitCode = 2
      })
  } else {
    console.error('Usage: <product.html> <new-review.json> | --batch <new-batch.json> <product1.html> ... | --drift <old-product.html> <new-product.html> | --drift-save <old-product.html> <new-product.html> <new-drift.json> | --selector-stability <new-review.json> <page1.html> <page2.html> ... | --selectors <catalog-or-offers.html> <new-review.json> | --selector-drift <old-page.html> <new-page.html> | --selector-drift-save <old-page.html> <new-page.html> <new-drift.json>')
    process.exitCode = 2
  }
}
