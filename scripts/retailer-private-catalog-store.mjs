import { mkdir, lstat, open, rm } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

import { validateRawProductObservation } from '../src/data/ingestion.ts'
const EXPORT_FIELDS = ['schemaVersion', 'model', 'status', 'sourceCount', 'productCount',
  'captureCount', 'conflictCount', 'products', 'productionEnabled', 'publicSavingsClaimEligible']
const PRODUCT_FIELDS = ['canonicalKey', 'retailerId', 'retailerProductId', 'captures',
  'consistency', 'currentTrustedPriceCents', 'selectedSnapshotSha256', 'sourceRightsVerified', 'publishable']
const CAPTURE_FIELDS = ['sourceKind', 'snapshotSha256', 'sourceUrl', 'capturedAt',
  'name', 'currentPriceCents', 'currency', 'pack', 'offer', 'availability']
const exactFields = (value, fields) =>
  value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
const validCount = n => Number.isSafeInteger(n) && n >= 0
const sourceHosts = { plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' }

// Do not trust direct callers to supply the canonical builder's output.
// Verify every nested assertion BEFORE opening an output file. Catalog data
// remains private evidence, never an authorized/selected retail price.
function assertPrivateRetailerCatalog(catalog) {
  if (!exactFields(catalog, EXPORT_FIELDS) ||
      !validCount(catalog.sourceCount) || catalog.sourceCount < 1 || catalog.sourceCount > 32 ||
      !validCount(catalog.productCount) || catalog.productCount !== catalog.products?.length ||
      catalog.productCount > 8192 || !validCount(catalog.captureCount) ||
      !validCount(catalog.conflictCount)) {
    throw new Error('Refusing unvalidated private catalog metadata')
  }
  const seen = new Set()
  let captures = 0
  let conflicts = 0
  for (const product of catalog.products) {
    if (!exactFields(product, PRODUCT_FIELDS) ||
        !Object.hasOwn(sourceHosts, product.retailerId) ||
        typeof product.retailerProductId !== 'string' ||
        !/^[a-zA-Z0-9._-]{1,160}$/.test(product.retailerProductId) ||
        product.canonicalKey !== product.retailerId + ':' + product.retailerProductId ||
        seen.has(product.canonicalKey) ||
        product.publishable !== false || product.sourceRightsVerified !== false ||
        product.currentTrustedPriceCents !== null || product.selectedSnapshotSha256 !== null ||
        !Array.isArray(product.captures) || product.captures.length < 1 ||
        product.captures.length > 32 ||
        !['consistent', 'review-required'].includes(product.consistency)) {
      throw new Error('Refusing untrusted private product or rights metadata')
    }
    seen.add(product.canonicalKey)
    const eventIds = new Set()
    const facts = new Set()
    for (const capture of product.captures) {
      if (!exactFields(capture, CAPTURE_FIELDS) ||
          !['catalog','offers','product'].includes(capture.sourceKind) ||
          !exactFields(capture.pack, ['rawText','amount','unit']) ||
          (capture.offer !== null &&
            !exactFields(capture.offer, ['label','mechanics','offerPriceCents',
              'originalPriceCents','validFrom','validTo']))) {
        throw new Error('Refusing malformed private capture shape')
      }
      // Reuse the original ingestion contract and then enforce stricter
      // direct-export boundaries: no credentials, future observations or
      // inexact monetary cents. Do not echo untrusted URL/price in errors.
      try {
        validateRawProductObservation({
          supermarket: product.retailerId,
          sourceProductId: product.retailerProductId,
          name: capture.name,
          currentPriceCents: capture.currentPriceCents,
          currency: capture.currency,
          pack: capture.pack,
          offer: capture.offer,
          availability: capture.availability,
          provenance: {
            supermarket: product.retailerId,
            kind: capture.sourceKind,
            url: capture.sourceUrl,
            capturedAt: capture.capturedAt,
            sha256: capture.snapshotSha256,
          },
        })
      } catch {
        throw new Error('Refusing unvalidated private capture provenance')
      }
      const url = new URL(capture.sourceUrl)
      if (url.hostname !== sourceHosts[product.retailerId] ||
          url.username || url.password || url.port || url.hash ||
          Date.parse(capture.capturedAt) > Date.now()) {
        throw new Error('Refusing private capture source identity')
      }
      const safe = n => n === null || (Number.isSafeInteger(n) && n >= 0)
      if (!safe(capture.currentPriceCents) ||
          (capture.offer && (!safe(capture.offer.offerPriceCents) ||
            !safe(capture.offer.originalPriceCents)))) {
        throw new Error('Refusing imprecise private capture cents')
      }
      const truth = JSON.stringify([
        capture.name, capture.currentPriceCents, capture.currency,
        capture.pack, capture.offer, capture.availability,
      ])
      const event = JSON.stringify([capture.sourceKind, capture.snapshotSha256,
        capture.sourceUrl, capture.capturedAt, truth])
      if (eventIds.has(event)) {
        throw new Error('Refusing duplicate private capture event')
      }
      eventIds.add(event)
      facts.add(truth)
      captures++
    }
    const expected = facts.size === 1 ? 'consistent' : 'review-required'
    if (product.consistency !== expected) {
      throw new Error('Refusing inconsistent private product provenance')
    }
    if (expected === 'review-required') conflicts++
  }
  if (captures !== catalog.captureCount || conflicts !== catalog.conflictCount) {
    throw new Error('Refusing forged private capture counts')
  }
}

// Optional private local JSON database export. Never publishes a catalog or
// chooses a price winner across conflicting captures. No default output.
export async function writePrivateRetailerCatalog(catalog, filename) {
  if (!catalog || catalog.schemaVersion !== 1 ||
      catalog.model !== 'universal-retailer-product-captures' ||
      catalog.status !== 'private-review-only' ||
      catalog.productionEnabled !== false ||
      catalog.publicSavingsClaimEligible !== false ||
      !Array.isArray(catalog.products)) {
    throw new Error('Refusing non-private/unvalidated catalog export')
  }
  assertPrivateRetailerCatalog(catalog)
  if (typeof filename !== 'string' ||
      filename.trim() !== filename ||
      !filename.endsWith('.json') ||
      filename.length > 500) {
    throw new Error('Invalid private catalog output path')
  }
  const path = resolve(filename)
  if (!/^[a-z0-9][a-z0-9_.-]*\.json$/i.test(basename(path)) ||
      basename(path).startsWith('.')) {
    throw new Error('Invalid private catalog filename')
  }
  // Resolve() alone is insufficient to catch aliases. Walk existing parents
  // before mkdir and again before exclusive creation; concurrent hostile path
  // swaps are NOT fully prevented by Node pathname-based filesystem operations.
  await assertNoSymlinkedM3OutputParents(path)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await assertNoSymlinkedM3OutputParents(path)
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error('Untrusted private catalog directory')
  }
  const data = JSON.stringify(catalog, null, 2) + '\n'
  let handle
  let created = false
  try {
    handle = await open(path, 'wx', 0o600)
    created = true
    await handle.writeFile(data, 'utf8')
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = undefined
  } catch (error) {
    if (handle) await handle.close()
    // Exclusive creation never overwrites preexisting evidence. If write
    // fails after creating a file, avoid leaving an incomplete apparent DB.
    if (created) {
      try {
        await assertNoSymlinkedM3OutputParents(path)
        const now = await lstat(path)
        if (now.isFile() && !now.isSymbolicLink()) await rm(path)
      } catch {
        // Avoid unlinking through an unsafe changed parent.
      }
    }
    throw new Error('Private catalog export failed; existing files preserved')
  }
  return { records: catalog.productCount, bytes: Buffer.byteLength(data, 'utf8') }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output') {
    throw new Error('Usage: retailer-private-catalog-store.mjs --output <private.json>')
  }
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  const result = await writePrivateRetailerCatalog(catalog, argv[1])
  process.stdout.write(JSON.stringify({ ...result, productionEnabled: false }) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private retailer export refused; no public catalog published')
    process.exitCode = 2
  })
}
