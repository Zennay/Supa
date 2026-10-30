/**
 * One approved HTML response -> one SHA-bound private price + selector
 * review archive. No default HTTP, retries, scheduler, price publishing,
 * permission grants, or public report of retailer data.
 */
import { open, lstat, rm, link } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { basename, dirname, isAbsolute } from 'node:path'
import { captureApprovedRetailerReviewBundle } from './retailer-approved-html-product-price-candidate.mjs'
import { safeSelectorProposals } from './retailer-approved-capture-selector-bridge.mjs'
import { isAllowedM1RetailerSourcePath } from './retailer-source-route-safety.mjs'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { compareOfflineSelectorProposals } from './retailer-private-selector-drift.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

const hosts = Object.freeze({ plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' })
const refuse = () => { throw new Error('Private source review archive refused') }
const rejectedReasons = new Set([
  'not_a_product_page', 'missing_or_invalid_jsonld',
  'unverified_schema_context', 'product_identity_or_price_unverified',
  'price_or_physical_pack_missing', 'stale_or_invalid_capture_clock',
  'availability_unverified',
])

function sourceRecord(value) {
  if (!value || !Object.hasOwn(hosts, value.retailerId) ||
      !['product', 'catalog', 'offers'].includes(value.kind) ||
      typeof value.url !== 'string' || value.url.length > 2048 ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.capturedAt !== 'string' ||
      Number.isNaN(Date.parse(value.capturedAt)) ||
      new Date(value.capturedAt).toISOString() !== value.capturedAt) refuse()
  let target
  try { target = new URL(value.url) } catch { refuse() }
  if (target.href !== value.url || target.protocol !== 'https:' ||
      target.hostname !== hosts[value.retailerId] ||
      target.port || target.username || target.password ||
      target.search || target.hash ||
      !isAllowedM1RetailerSourcePath(value.retailerId, value.kind, target.pathname)) refuse()
  return { retailerId: value.retailerId, kind: value.kind, url: value.url,
    capturedAt: value.capturedAt, sha256: value.sha256 }
}

function safeArchive(bundle) {
  if (!bundle || bundle.schemaVersion !== 1 ||
      !['private-authorized-one-capture-product-review',
        'private-authorized-one-capture-structural-review'].includes(bundle.mode) ||
      bundle.actualTransportInvocations !== 1 ||
      !Number.isSafeInteger(bundle.capturedBytes) || bundle.capturedBytes < 1 ||
      bundle.capturedBytes > 5 * 1024 * 1024 ||
      bundle.rawHtmlReturned !== false || bundle.humanReviewRequired !== true ||
      bundle.verifiedCurrentCheckoutPrice !== false ||
      bundle.sourceRightsForPublicationVerified !== false ||
      bundle.publicSavingsClaimEligible !== false ||
      bundle.readyForIngestion !== false || bundle.productionEnabled !== false ||
      bundle.published !== false) refuse()

  const source = sourceRecord(bundle.source)
  const review = bundle.selectorReview
  if (!review || review.mode !== 'private-unapproved-selector-proposals' ||
      review.humanReviewRequired !== true || review.approvedSelectors !== 0 ||
      !Array.isArray(review.proposals) || review.proposals.length > 24 ||
      !Number.isSafeInteger(review.privateProposalsOmitted) ||
      review.privateProposalsOmitted < 0 ||
      !Number.isSafeInteger(review.inspectedTags) ||
      review.inspectedTags < 0) refuse()
  const signalNames = ['schemaOrgProduct', 'nextData', 'nuxtData', 'jsonLd']
  if (!review.structuredSignals || Object.keys(review.structuredSignals).length !== 4 ||
      signalNames.some(key => typeof review.structuredSignals[key] !== 'boolean')) refuse()
  const structuredSignals = Object.fromEntries(signalNames.map(key =>
    [key, review.structuredSignals[key]]))
  const proposals = safeSelectorProposals(review.proposals, source.retailerId)
  if (proposals.length !== review.proposals.length ||
      proposals.some((p, i) =>
        p.field !== review.proposals[i].field ||
        p.selector !== review.proposals[i].selector ||
        p.instances !== review.proposals[i].instances ||
        p.status !== 'needs-human-review')) refuse()

  const price = bundle.priceReview
  if (source.kind === 'product') {
    if (bundle.mode !== 'private-authorized-one-capture-product-review' ||
        !price || price.mode !== 'private-authorized-html-product-candidate' ||
        price.permissionVerifiedForThisRequest !== true ||
        price.humanReviewRequired !== true ||
        price.verifiedCurrentCheckoutPrice !== false ||
        price.publicSavingsClaimEligible !== false ||
        price.productionEnabled !== false || price.published !== false ||
        JSON.stringify(sourceRecord(price.source)) !== JSON.stringify(source)) refuse()
    if (price.status === 'candidate_needs_review') {
      if (price.reason !== null || !price.observation) refuse()
      try { validateRawProductObservation(price.observation) } catch { refuse() }
      const o = price.observation, provenance = o.provenance
      if (o.supermarket !== source.retailerId ||
          !Number.isSafeInteger(o.currentPriceCents) || o.currentPriceCents <= 0 ||
          o.availability !== 'available' || !o.pack ||
          o.pack.amount === null || ['unknown','pack'].includes(o.pack.unit) ||
          provenance?.url !== source.url || provenance.sha256 !== source.sha256 ||
          provenance.capturedAt !== source.capturedAt ||
          provenance.supermarket !== source.retailerId ||
          provenance.kind !== 'product') refuse()
    } else if (price.status !== 'review_required' ||
        price.observation !== null || !rejectedReasons.has(price.reason)) refuse()
  } else if (price !== null ||
      bundle.mode !== 'private-authorized-one-capture-structural-review') refuse()

  const archive = {
    schemaVersion: 1,
    mode: 'private-one-source-price-and-selector-review',
    source, capturedBytes: bundle.capturedBytes,
    priceReview: price === null ? null : {
      status: price.status, reason: price.reason,
      observation: price.status === 'candidate_needs_review' ? price.observation : null,
    },
    selectorReview: {
      proposals, structuredSignals,
      privateProposalsOmitted: review.privateProposalsOmitted,
      inspectedTags: review.inspectedTags,
      approvedSelectors: 0,
    },
    humanReviewRequired: true, verifiedCurrentCheckoutPrice: false,
    sourceRightsForPublicationVerified: false, readyForIngestion: false,
    publicSavingsClaimEligible: false, productionEnabled: false, published: false,
  }
  // Private price/name/URL allowed on operator disk only, never returned as CLI status.
  const bytes = JSON.stringify(archive, null, 2) + '\n'
  if (Buffer.byteLength(bytes, 'utf8') > 48 * 1024) refuse()
  return { bytes, candidateCount: price?.status === 'candidate_needs_review' ? 1 : 0,
    reviewRequiredCount: price?.status === 'review_required' ? 1 : 0,
    selectorCount: proposals.length, sourceKind: source.kind }
}

async function privatePath(file) {
  if (typeof file !== 'string' || file.length > 512 ||
      !isAbsolute(file) || file.includes('/../') ||
      !/^[a-z][a-z0-9_.-]{0,79}\.json$/i.test(basename(file))) refuse()
  await assertNoSymlinkedM3OutputParents(file)
  const parent = await lstat(dirname(file))
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      (parent.mode & 0o077) !== 0) refuse()
  try {
    await lstat(file)
    refuse() // never fetch source if the destination already exists
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return file
}

async function publish(file, bytes) {
  await privatePath(file)
  const parentPath = dirname(file)
  const parent = await lstat(parentPath)
  const staging = parentPath + '/.' + basename(file) + '.staging-' + randomUUID()
  let handle
  try {
    // A crash while writing can only leave an owner-only staging file.
    // The final review path appears *after* all its bytes are durable.
    handle = await open(staging, 'wx', 0o600)
    await handle.writeFile(bytes, 'utf8')
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = null
    const current = await lstat(parentPath)
    const staged = await lstat(staging)
    if (!current.isDirectory() || current.dev !== parent.dev ||
        current.ino !== parent.ino || (current.mode & 0o077) !== 0 ||
        !staged.isFile() || staged.isSymbolicLink() ||
        staged.nlink !== 1 || (staged.mode & 0o777) !== 0o600) refuse()
    // link() is NO-REPLACE: unlike rename(), a competing archive cannot
    // overwrite an existing artifact. Readers only see complete bytes.
    await link(staging, file)
    const dir = await open(parentPath, 'r')
    try { await dir.sync() } finally { await dir.close() }
  } catch { refuse() }
  finally {
    if (handle) await handle.close()
    // Never delete the complete final output after a successful link.
    await rm(staging, { force: true })
  }
}

/** One strictly authorized source fetch, one private 0600 review artifact. */
export async function captureAndArchiveApprovedSourceReview(options, file) {
  await privatePath(file) // refuse invalid output without making a network request
  const bundle = await captureApprovedRetailerReviewBundle(options)
  const archive = safeArchive(bundle)
  await publish(file, archive.bytes)
  return {
    mode: 'private-one-source-review-archive',
    archiveCreated: true, sourceKind: archive.sourceKind,
    actualTransportInvocations: 1,
    selectorCount: archive.selectorCount,
    candidateCount: archive.candidateCount,
    reviewRequiredCount: archive.reviewRequiredCount,
    humanReviewRequired: true, approvedSelectors: 0,
    verifiedCurrentCheckoutPrice: false,
    sourceRightsForPublicationVerified: false,
    publicSavingsClaimEligible: false,
    readyForIngestion: false, productionEnabled: false, published: false,
  }
}

/** Verify a SHA-pinned private archive's strict canonical bytes before drift. */
async function readPrivateReview(file) {
  if (typeof file !== 'string' || !isAbsolute(file) ||
      file.includes('/../') || file.length > 512 ||
      !/^[a-z][a-z0-9_.-]{0,79}\.json$/i.test(basename(file))) refuse()
  try {
    await assertNoSymlinkedM3OutputParents(file)
    const parent = await lstat(dirname(file))
    if (!parent.isDirectory() || parent.isSymbolicLink() ||
        (parent.mode & 0o077) !== 0) refuse()
    const identity = await lstat(file)
    if (!identity.isFile() || identity.isSymbolicLink() ||
        identity.nlink !== 1 || (identity.mode & 0o777) !== 0o600 ||
        identity.uid !== process.getuid() || identity.size < 2 ||
        identity.size > 48 * 1024) refuse()
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    let raw
    try {
      const current = await handle.stat()
      if (current.dev !== identity.dev || current.ino !== identity.ino ||
          current.size !== identity.size) refuse()
      raw = await handle.readFile('utf8')
    } finally { await handle.close() }
    const data = JSON.parse(raw)
    const source = data.source, price = data.priceReview, review = data.selectorReview
    const reconstructed = {
      schemaVersion: 1,
      mode: source?.kind === 'product'
        ? 'private-authorized-one-capture-product-review'
        : 'private-authorized-one-capture-structural-review',
      source, capturedBytes: data.capturedBytes, actualTransportInvocations: 1,
      priceReview: price === null ? null : {
        mode: 'private-authorized-html-product-candidate',
        source, status: price?.status, reason: price?.reason,
        observation: price?.observation, humanReviewRequired: true,
        permissionVerifiedForThisRequest: true,
        verifiedCurrentCheckoutPrice: false, publicSavingsClaimEligible: false,
        productionEnabled: false, published: false,
      },
      selectorReview: {
        mode: 'private-unapproved-selector-proposals',
        proposals: review?.proposals,
        structuredSignals: review?.structuredSignals,
        privateProposalsOmitted: review?.privateProposalsOmitted,
        inspectedTags: review?.inspectedTags,
        humanReviewRequired: true, approvedSelectors: 0,
      },
      rawHtmlReturned: false, humanReviewRequired: true,
      verifiedCurrentCheckoutPrice: false,
      sourceRightsForPublicationVerified: false, publicSavingsClaimEligible: false,
      readyForIngestion: false, productionEnabled: false, published: false,
    }
    // Strict byte equality rejects duplicate keys and altered privacy flags.
    if (safeArchive(reconstructed).bytes !== raw) refuse()
    return data
  } catch { refuse() }
}

/** Offline structural drift only. Never surface CSS, names, URLs, or prices. */
export async function compareArchivedSourceReviews(beforeFile, afterFile) {
  const [before, after] = await Promise.all([
    readPrivateReview(beforeFile), readPrivateReview(afterFile),
  ])
  if (before.source.retailerId !== after.source.retailerId ||
      before.source.kind !== after.source.kind ||
      before.source.url !== after.source.url) refuse()
  const report = entry => ({
    schemaVersion: 1, mode: 'offline-selector-proposals-only',
    source: { retailerId: entry.source.retailerId,
      sha256: entry.source.sha256, capturedAt: entry.source.capturedAt },
    bytes: entry.capturedBytes, scannedTags: entry.selectorReview.inspectedTags,
    structuredSignals: entry.selectorReview.structuredSignals,
    selectors: entry.selectorReview.proposals.map(
      ({ field, selector, instances, status }) => ({ field, selector, instances, status })),
    humanReviewRequired: true, readyForIngestion: false,
    permissionVerified: false, productionEnabled: false,
    publicSavingsClaimEligible: false,
  })
  try {
    const drift = compareOfflineSelectorProposals(report(before), report(after))
    return { ...drift, mode: 'private-one-source-review-selector-drift',
      humanReviewRequired: true, published: false, readyForIngestion: false,
      verifiedCurrentCheckoutPrice: false }
  } catch { refuse() }
}

/** Read-only CLI: aggregate drift only. No embedded HTTP or source extraction. */
export async function main(argv = process.argv.slice(2),
  write = value => process.stdout.write(value)) {
  if (argv.length !== 3 || argv[0] !== '--compare') refuse()
  const result = await compareArchivedSourceReviews(argv[1], argv[2])
  write(JSON.stringify(result) + '\n')
  return 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Private source review archive refused\n')
    process.exitCode = 1
  })
}
