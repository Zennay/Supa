/**
 * Private 0600 archive of captured *unreviewed* price candidates.
 *
 * Completes capture -> validate -> durable operator review evidence without
 * turning a scraped price into an automatically trusted user-facing quote.
 * Creates a NEW file exclusively, never overwrites, no HTTP or schedule.
 */
import { types as nodeTypes } from 'node:util'
import { open, lstat, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

const MAX_CANDIDATES = 22
const MAX_DEPTH = 14
const refuse = () => { throw new Error('Private retailer price candidate archive refused') }

function inert(value, depth = 0) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string' && value.length > 4096) refuse()
    if (typeof value === 'number' && !Number.isFinite(value)) refuse()
    return value
  }
  if (depth > MAX_DEPTH || typeof value !== 'object' || nodeTypes.isProxy(value)) refuse()
  const array = Array.isArray(value)
  const proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) refuse()
  const desc = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(desc).some(key => typeof key !== 'string')) refuse()
  if (array) {
    const length = desc.length
    if (!length || !Object.hasOwn(length, 'value') || length.value > MAX_CANDIDATES ||
        Reflect.ownKeys(desc).length !== length.value + 1) refuse()
    const copy = []
    for (let i = 0; i < length.value; i++) {
      if (!desc[i] || !Object.hasOwn(desc[i], 'value')) refuse()
      copy.push(inert(desc[i].value, depth + 1))
    }
    return copy
  }
  if (Reflect.ownKeys(desc).length > 24) refuse()
  const copy = Object.create(null)
  for (const [key, item] of Object.entries(desc)) {
    if (!Object.hasOwn(item, 'value') || key === '__proto__') refuse()
    copy[key] = inert(item.value, depth + 1)
  }
  return copy
}

const permittedReasons = new Set([
  'not_a_product_page', 'missing_or_invalid_jsonld',
  'unverified_schema_context',
  'product_identity_or_price_unverified', 'price_or_physical_pack_missing',
  'stale_or_invalid_capture_clock', 'availability_unverified',
])
const hosts = { plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' }

// Failed or out-of-stock captures still need an independently attributable
// original article URL in the private archive. Never accept only a host name,
// a sibling SKU, a redirect or a caller-supplied source without a route.
function approvedSourceUrl(source) {
  if (typeof source?.url !== 'string' || source.url.length > 2048 ||
      !Object.hasOwn(hosts, source.retailerId)) return false
  try {
    const parsed = new URL(source.url)
    const prefix = source.retailerId === 'plus' ? '/product/' : '/producten/'
    return parsed.href === source.url && parsed.protocol === 'https:' &&
      parsed.hostname === hosts[source.retailerId] && !parsed.port &&
      !parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
      parsed.pathname.startsWith(prefix) && parsed.pathname.length > prefix.length
  } catch {
    return false
  }
}

function admitted(value) {
  if (!value || value.mode !== 'private-authorized-html-product-candidate' ||
      !['candidate_needs_review', 'review_required'].includes(value.status) ||
      value.humanReviewRequired !== true ||
      value.permissionVerifiedForThisRequest !== true ||
      value.verifiedCurrentCheckoutPrice !== false ||
      value.publicSavingsClaimEligible !== false ||
      value.productionEnabled !== false || value.published !== false ||
      !value.source ||
      !Object.hasOwn(hosts, value.source.retailerId) ||
      value.source.kind !== 'product' ||
      !approvedSourceUrl(value.source) ||
      typeof value.source.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.source.sha256) ||
      typeof value.source.capturedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.source.capturedAt) ||
      !Number.isFinite(Date.parse(value.source.capturedAt)) ||
      new Date(Date.parse(value.source.capturedAt)).toISOString() !== value.source.capturedAt ||
      Date.parse(value.source.capturedAt) > Date.now() + 60_000) refuse()

  if (value.status === 'review_required') {
    if (value.observation !== null || !permittedReasons.has(value.reason)) refuse()
    return { source: value.source, status: value.status,
      reason: value.reason, observation: null }
  }
  if (value.reason !== null || !value.observation) refuse()
  const observation = value.observation
  try { validateRawProductObservation(observation) } catch { refuse() }
  const provenance = observation.provenance
  if (observation.supermarket !== value.source.retailerId ||
      provenance.supermarket !== value.source.retailerId ||
      provenance.kind !== 'product' ||
      provenance.capturedAt !== value.source.capturedAt ||
      provenance.sha256 !== value.source.sha256 ||
      provenance.url !== value.source.url ||
      observation.currentPriceCents === null ||
      observation.currentPriceCents <= 0 ||
      observation.pack.amount === null ||
      ['unknown', 'pack'].includes(observation.pack.unit) ||
      observation.availability !== 'available' ||
      Date.now() - Date.parse(provenance.capturedAt) > 24 * 3600_000) refuse()
  return { source: value.source, status: value.status,
    reason: null, observation }
}

/**
 * No public claims; snapshot remains an operator review queue. The source
 * HTML is never persisted here. Runtime-provided price candidates must be
 * produced via the existing authorized one-URL capture, not guessed.
 */
export async function writePrivateRetailerPriceSnapshot(candidates, outputFile) {
  const copied = inert(candidates)
  if (!Array.isArray(copied) || copied.length < 1 ||
      copied.length > MAX_CANDIDATES) refuse()
  const entries = copied.map(admitted)
  const identities = new Set()
  for (const item of entries) {
    const key = [item.source.retailerId, item.source.kind,
      item.source.url, item.source.sha256, item.source.capturedAt].join(':')
    if (identities.has(key)) refuse()
    identities.add(key)
  }
  if (typeof outputFile !== 'string' || outputFile.length > 512 ||
      outputFile.trim() !== outputFile) refuse()
  const path = resolve(outputFile)
  if (!/^[a-z][a-z0-9_.-]{0,79}\.json$/i.test(basename(path))) refuse()
  const archive = {
    schemaVersion: 1, mode: 'private-unreviewed-retailer-price-candidates',
    count: entries.length,
    candidateCount: entries.filter(x => x.status === 'candidate_needs_review').length,
    reviewRequiredCount: entries.filter(x => x.status === 'review_required').length,
    entries, humanReviewRequired: true,
    sourceRightsForPublicationVerified: false,
    verifiedCurrentCheckoutPrices: 0,
    publicSavingsClaimEligible: false,
    productionEnabled: false, published: false,
  }
  const bytes = JSON.stringify(archive, null, 2) + '\n'
  await assertNoSymlinkedM3OutputParents(path)
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink()) refuse()
  let handle
  let created = false
  try {
    handle = await open(path, 'wx', 0o600)
    created = true
    await handle.writeFile(bytes, 'utf8')
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = null
  } catch {
    if (handle) await handle.close()
    if (created) {
      try {
        await assertNoSymlinkedM3OutputParents(path)
        const current = await lstat(path)
        if (current.isFile() && !current.isSymbolicLink()) await rm(path)
      } catch { /* refuse to unlink through an unsafe replaced path */ }
    }
    refuse()
  }
  return { count: archive.count, candidateCount: archive.candidateCount,
    reviewRequiredCount: archive.reviewRequiredCount,
    publicSavingsClaimEligible: false, productionEnabled: false }
}
