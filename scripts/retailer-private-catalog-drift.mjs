/**
 * Offline SUPA source-history drift review for two privately persisted
 * universal retailer catalogs. Output is strictly aggregate-only.
 *
 * A missing item means NOT PRESENT IN THIS REVIEW DATASET; it never means
 * delisted/unavailable at a retailer. Different bytes/prices are a question
 * for a human, never an automatically trusted price or savings claim.
 */
import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const STORES = Object.freeze(['plus', 'dekamarkt'])
const HOST = Object.freeze({ plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' })
const SHA = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9._-]{1,160}$/
const KINDS = new Set(['product', 'catalog', 'offers'])
const AVAIL = new Set(['available', 'unavailable', 'unknown'])
const UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece', 'pack', 'unknown'])
const own = (o, key) => o !== null && typeof o === 'object' && Object.hasOwn(o, key)
const fields = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every(k => own(o,k))
const money = n => n === null || (Number.isSafeInteger(n) && n >= 0)
const fail = () => { throw new Error('Private retailer drift review refused') }
const requiredCaptureFields = ['sourceKind','snapshotSha256','sourceUrl','capturedAt','name',
  'currentPriceCents','currency','pack','offer','availability']
const requiredProductFields = ['canonicalKey','retailerId','retailerProductId','captures',
  'consistency','currentTrustedPriceCents','selectedSnapshotSha256','sourceRightsVerified','publishable']
const requiredCatalogFields = ['schemaVersion','model','status','sourceCount','productCount',
  'captureCount','conflictCount','products','productionEnabled','publicSavingsClaimEligible']

function captureIdentity(c) {
  return JSON.stringify([c.sourceKind,c.snapshotSha256,c.sourceUrl,c.capturedAt])
}
function captureTruth(c) {
  return JSON.stringify([c.name,c.currentPriceCents,c.currency,c.pack,c.offer,c.availability])
}
function approvedCapture(c,retailer) {
  if (!fields(c, requiredCaptureFields) || !KINDS.has(c.sourceKind) ||
      typeof c.snapshotSha256 !== 'string' || !SHA.test(c.snapshotSha256) ||
      typeof c.sourceUrl !== 'string' || c.sourceUrl.length > 2048 ||
      typeof c.capturedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(c.capturedAt) ||
      !Number.isFinite(Date.parse(c.capturedAt)) || Date.parse(c.capturedAt) > Date.now() ||
      typeof c.name !== 'string' || !c.name.trim() || c.name.length > 1024 ||
      c.currency !== 'EUR' || !money(c.currentPriceCents) ||
      !AVAIL.has(c.availability) ||
      !fields(c.pack,['rawText','amount','unit']) ||
      !UNITS.has(c.pack.unit) ||
      (c.pack.rawText !== null && (typeof c.pack.rawText !== 'string' ||
        !c.pack.rawText.trim() || c.pack.rawText.length > 256)) ||
      (c.pack.amount !== null && (!Number.isFinite(c.pack.amount) || c.pack.amount <= 0)) ||
      (c.offer !== null && (!fields(c.offer,['label','mechanics','offerPriceCents',
        'originalPriceCents','validFrom','validTo']) ||
        typeof c.offer.label !== 'string' || !c.offer.label.trim() ||
        !money(c.offer.offerPriceCents) || !money(c.offer.originalPriceCents) ||
        (c.offer.mechanics !== null && typeof c.offer.mechanics !== 'string') ||
        (c.offer.validFrom !== null && (typeof c.offer.validFrom !== 'string' ||
          !Number.isFinite(Date.parse(c.offer.validFrom)))) ||
        (c.offer.validTo !== null && (typeof c.offer.validTo !== 'string' ||
          !Number.isFinite(Date.parse(c.offer.validTo))))))) fail()
  let url
  try { url = new URL(c.sourceUrl) } catch { fail() }
  if (url.protocol !== 'https:' || url.hostname !== HOST[retailer] ||
      url.username || url.password || url.port || url.hash ||
      [...url.searchParams.keys()].some(k => /(?:token|secret|key|session|auth|password|credential)/i.test(k))) fail()
}
function approvedCatalog(c) {
  if (!fields(c,requiredCatalogFields) ||
      c.schemaVersion !== 1 || c.model !== 'universal-retailer-product-captures' ||
      c.status !== 'private-review-only' ||
      c.productionEnabled !== false || c.publicSavingsClaimEligible !== false ||
      !Array.isArray(c.products) || c.products.length > 5000 ||
      c.productCount !== c.products.length ||
      !Number.isSafeInteger(c.sourceCount) || c.sourceCount < 1 || c.sourceCount > 32 ||
      !Number.isSafeInteger(c.captureCount) || c.captureCount < 1 || c.captureCount > 25000 ||
      !Number.isSafeInteger(c.conflictCount) || c.conflictCount < 0) fail()
  const map = new Map()
  let captures = 0
  let conflicts = 0
  for (let i=0;i<c.products.length;i++) {
    if (!Object.hasOwn(c.products,i)) fail()
    const p = c.products[i]
    if (!fields(p,requiredProductFields) || !STORES.includes(p.retailerId) ||
        typeof p.retailerProductId !== 'string' || !ID.test(p.retailerProductId) ||
        p.canonicalKey !== p.retailerId + ':' + p.retailerProductId ||
        map.has(p.canonicalKey) || p.publishable !== false ||
        p.sourceRightsVerified !== false || p.currentTrustedPriceCents !== null ||
        p.selectedSnapshotSha256 !== null || !Array.isArray(p.captures) ||
        !p.captures.length || p.captures.length > 32 ||
        !['consistent','review-required'].includes(p.consistency)) fail()
    const signatures = new Set()
    const events = new Map()
    for (let j=0;j<p.captures.length;j++) {
      if (!Object.hasOwn(p.captures,j)) fail()
      const capture = p.captures[j]
      approvedCapture(capture,p.retailerId)
      const identity = captureIdentity(capture)
      if (events.has(identity)) fail()
      const signature = captureTruth(capture)
      events.set(identity,signature)
      signatures.add(signature)
      captures++
    }
    const expected = signatures.size === 1 ? 'consistent' : 'review-required'
    if (p.consistency !== expected) fail()
    if (expected === 'review-required') conflicts++
    map.set(p.canonicalKey, { retailer: p.retailerId, events, signatures })
  }
  if (captures !== c.captureCount || conflicts !== c.conflictCount) fail()
  return map
}

/** All counts refer to OFFLINE DATASET COVERAGE, never live retailer stock. */
export function comparePrivateRetailerCatalogs(baseline, candidate) {
  const old = approvedCatalog(baseline)
  const now = approvedCatalog(candidate)
  const changes = {
    schemaVersion: 1, mode: 'private-historical-retailer-drift-review',
    productionEnabled: false, publicSavingsClaimEligible: false,
    livePricesAvailable: false, externalRequests: 0, needsHumanReview: true,
    newProductIdsInDataset: 0, missingProductIdsInCandidateDataset: 0,
    newCaptureEvents: 0, missingCaptureEventsInCandidateDataset: 0,
    repeatedCaptureEvents: 0, factSetChangesNeedingReview: 0,
    inconsistentProductHistories: 0,
    perRetailer: {
      plus: { newProductIdsInDataset:0, missingProductIdsInCandidateDataset:0,
        newCaptureEvents:0, missingCaptureEventsInCandidateDataset:0,
        repeatedCaptureEvents:0, factSetChangesNeedingReview:0, inconsistentProductHistories:0 },
      dekamarkt: { newProductIdsInDataset:0, missingProductIdsInCandidateDataset:0,
        newCaptureEvents:0, missingCaptureEventsInCandidateDataset:0,
        repeatedCaptureEvents:0, factSetChangesNeedingReview:0, inconsistentProductHistories:0 },
    },
  }
  const bump = (retailer,field) => {
    changes[field]++
    changes.perRetailer[retailer][field]++
  }
  for (const [key, latest] of now) {
    const before = old.get(key)
    if (!before) bump(latest.retailer,'newProductIdsInDataset')
    if (latest.signatures.size > 1) bump(latest.retailer,'inconsistentProductHistories')
    if (before && (before.signatures.size !== latest.signatures.size ||
        [...before.signatures].some(x => !latest.signatures.has(x)))) {
      bump(latest.retailer,'factSetChangesNeedingReview')
    }
    for (const [event,truth] of latest.events) {
      if (!before || !before.events.has(event)) bump(latest.retailer,'newCaptureEvents')
      else if (before.events.get(event) !== truth) fail() // Same immutable capture ID cannot change content.
      else bump(latest.retailer,'repeatedCaptureEvents')
    }
  }
  for (const [key,before] of old) {
    const latest = now.get(key)
    if (!latest) bump(before.retailer,'missingProductIdsInCandidateDataset')
    for (const event of before.events.keys()) {
      if (!latest || !latest.events.has(event)) {
        bump(before.retailer,'missingCaptureEventsInCandidateDataset')
      }
    }
  }
  return changes
}

async function privateJson(file) {
  if (typeof file !== 'string' || !file || file.startsWith('-') || file.length > 500 ||
      !/^[a-z0-9][a-z0-9_.-]*\.json$/i.test(basename(file))) fail()
  const path = resolve(file)
  let parent = path
  while (true) {
    const s = await lstat(parent)
    if (s.isSymbolicLink()) fail()
    if (parent === path && (!s.isFile() || (s.mode & 0o077) || s.size > 8*1024*1024)) fail()
    const next = dirname(parent)
    if (next === parent) break
    parent = next
  }
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = await fd.stat()
    if (!s.isFile() || (s.mode & 0o077) || s.size > 8*1024*1024) fail()
    const data = await fd.readFile('utf8')
    if (Buffer.byteLength(data,'utf8') > 8*1024*1024) fail()
    return JSON.parse(data)
  } finally { await fd.close() }
}
export async function main(argv=process.argv.slice(2), write=text=>process.stdout.write(text)) {
  if (!Array.isArray(argv) || argv.length !== 4 ||
      argv[0] !== '--before' || argv[2] !== '--after') fail()
  if (resolve(argv[1]) === resolve(argv[3])) fail()
  const comparison = comparePrivateRetailerCatalogs(
    await privateJson(argv[1]),await privateJson(argv[3]))
  write(JSON.stringify(comparison) + '\n')
  return comparison
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private historical retailer drift review refused')
    process.exitCode = 2
  })
}
