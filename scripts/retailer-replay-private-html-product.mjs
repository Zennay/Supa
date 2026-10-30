/** Offline 0600 HTML+manifest replay. No HTTP, rights grant or publication. */
import { createHash } from 'node:crypto'
import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'
import { readAuthorizedHtmlScriptEvidence } from './retailer-approved-html-script-evidence.mjs'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { parseDekaNuxtFromAuthorizedHtml } from './retailer-approved-deka-nuxt-product.mjs'
import { proposeOfflineRetailerSelectors } from './retailer-offline-selector-discovery.mjs'
import { compareOfflineSelectorProposals } from './retailer-private-selector-drift.mjs'

const LIMIT = 2 * 1024 * 1024
const HOST = Object.freeze({ plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' })
const fail = () => { throw Error('Private source replay refused: untrusted HTML or manifest') }
async function privateBytes(path, size) {
  await assertNoSymlinkedM3OutputParents(path)
  // No path-based read after checking metadata: a replaced symlink must not
  // redirect the read to an unrelated source. Validate the opened inode.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW |
    constants.O_NONBLOCK)
  try {
    const meta = await handle.stat()
    if (!meta.isFile() || (meta.mode & 0o077) !== 0 ||
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
      !record.source || record.source.kind !== 'product' ||
      !Object.hasOwn(HOST, record.source.retailerId) ||
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
      !url.pathname.startsWith(src.retailerId === 'plus' ? '/product/' : '/producten/')) fail()
  const ms = Date.parse(src.capturedAt)
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(src.capturedAt) ||
      !Number.isFinite(ms) || new Date(ms).toISOString() !== src.capturedAt ||
      ms > Date.now() + 60_000) fail()
  return src
}

/** Existing private capture bytes only: this function cannot fetch or publish. */
export async function replayPrivateProductHtmlSnapshot(filename) {
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
  const scripts = readAuthorizedHtmlScriptEvidence(html)
  if (scripts.invalid || scripts.jsonLdBlocks.length > 16) fail()
  let parsed = parseSchemaOrgProductForPage(scripts.jsonLdBlocks, provenance)
  if (src.retailerId === 'dekamarkt' &&
      (parsed.type !== 'observation' || parsed.observation.currentPriceCents === null ||
       parsed.observation.pack.amount === null)) {
    const alt = parseDekaNuxtFromAuthorizedHtml({
      html, provenance, jsonLdBlocks: scripts.jsonLdBlocks,
    })
    if (alt.type === 'observation') parsed = alt
  }
  const selectors = proposeOfflineRetailerSelectors({
    html, origin: { retailerId: src.retailerId, url: src.url, capturedAt: src.capturedAt },
  })
  if (selectors.source.sha256 !== src.sha256) fail()
  const price = parsed.type === 'observation' ? parsed.observation : null
  const plausible = price && Number.isSafeInteger(price.currentPriceCents) &&
    price.currentPriceCents > 0 && price.pack.amount !== null &&
    price.availability === 'available' &&
    !['unknown', 'pack'].includes(price.pack.unit)
  return {
    schemaVersion: 1, mode: 'offline-private-product-review',
    // Pin the actual product URL without returning or logging that private URL.
    // Drift between two unrelated SKUs is not a real selector regression.
    source: { retailerId: src.retailerId, capturedAt: src.capturedAt,
      sha256: src.sha256,
      productUrlSha256: createHash('sha256').update(src.url).digest('hex') },
    status: plausible ? 'candidate_for_human_review' : 'unverified_product',
    observation: plausible ? price : null,
    selectorProposals: selectors.selectors,
    selectorSnapshot: selectors, selectorReviewRequired: true,
    permissionVerifiedForThisReplay: false, sourceRightsForPublicationVerified: false,
    verifiedCurrentCheckoutPrice: false, readyForIngestion: false,
    publicSavingsClaimEligible: false, productionEnabled: false, published: false,
  }
}

/**
 * Compare two independently SHA-verified original private HTML snapshots;
 * returns count-only selector drift, never proposed names, HTML or prices.
 */
export async function compareArchivedPrivateProductSnapshots(beforeHtml, afterHtml) {
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
  return {
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
  if (!dir.isDirectory() || dir.isSymbolicLink()) fail()
  let file, created = false
  try {
    file = await open(target, 'wx', 0o600)
    created = true
    await file.writeFile(JSON.stringify(record, null, 2) + '\n', 'utf8')
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
        if (current.isFile() && !current.isSymbolicLink()) await rm(target)
      } catch { /* refuse unsafe cleanup */ }
    }
    fail()
  }
  return { created: true, status: record.status, humanReviewRequired: true,
    published: false, productionEnabled: false }
}

export async function savePrivateOfflineProductReview(htmlFile, reviewFile) {
  return writePrivateReviewRecord(await replayPrivateProductHtmlSnapshot(htmlFile),
    reviewFile)
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
  const saved = await writePrivateReviewRecord({
    schemaVersion: 1, mode: 'offline-private-product-review-batch',
    status: 'private-batch-needs-review',
    count: records.length,
    candidateCount: records.filter(x => x.status === 'candidate_for_human_review').length,
    unverifiedCount: records.filter(x => x.status === 'unverified_product').length,
    entries: records, retailerCounts, humanReviewRequired: true,
    sourceRightsForPublicationVerified: false, verifiedCurrentCheckoutPrices: 0,
    productionEnabled: false, published: false, publicSavingsClaimEligible: false,
  }, reviewFile)
  return { ...saved, count: records.length,
    candidateCount: records.filter(x => x.status === 'candidate_for_human_review').length,
    unverifiedCount: records.filter(x => x.status === 'unverified_product').length,
    retailerCounts }
}

// Operator CLI: no network and no source URL, price, HTML or private path stdout.
const { pathToFileURL } = await import('node:url')
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args[0] === '--batch' && args.length >= 3 && args.length <= 24) {
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
    console.error('Usage: retailer-replay-private-html-product.mjs <captured.html> <new-review.json> OR --drift <before.html> <after.html> OR --batch <new-review.json> <source1.html> [source2.html ...]')
    process.exitCode = 2
  }
}
