/**
 * PRIVATE, REVIEW-ONLY cross-store pairing by canonicalized product name and
 * physical pack amount. This is NOT a price comparison, verified equivalence
 * claim, public match, license, or automatic recommendation.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { comparePrivateRetailerCatalogs } from './retailer-private-catalog-drift.mjs'
import { buildUniversalRetailerCatalog } from './retailer-universal-catalog.mjs'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const fail = () => { throw new Error('Private cross-retailer matching review refused') }
const validId = x => typeof x === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(x)
const STORES = ['plus', 'dekamarkt']
const MAX_CANDIDATES = 500
const MAX_WORDS = 20

function nameSignature(raw) {
  if (typeof raw !== 'string' || raw.length < 4 || raw.length > 1024) return null
  const normalized = raw.normalize('NFKC').toLocaleLowerCase('nl-NL').trim()
  const words = normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  // A single generic word (e.g. "melk") is not a robust brand/SKU match.
  if (words.length < 2 || words.length > MAX_WORDS ||
      words.some(word => word.length > 60)) return null
  return words.sort().join(' ')
}

function unitSignature(pack) {
  if (!pack || typeof pack !== 'object' ||
      !Number.isFinite(pack.amount) || pack.amount <= 0 ||
      pack.amount > 1_000_000) return null
  // A counted "pack" or "piece" without a comparable weight or volume
  // is ambiguous; never infer a match from packaging labels alone.
  const unit = pack.unit
  const factor = unit === 'kg' || unit === 'l' ? 1000 :
    unit === 'g' || unit === 'ml' ? 1 : null
  if (factor === null) return null
  const physical = pack.amount * factor
  const milli = Math.round(physical * 1000)
  if (!Number.isSafeInteger(milli) || milli <= 0 ||
      Math.abs(physical * 1000 - milli) > 1e-6) return null
  return (unit === 'kg' || unit === 'g' ? 'mass:' : 'volume:') + milli
}

function keyed(products, store, excluded) {
  const groups = new Map()
  for (const product of products) {
    if (product.retailerId !== store) continue
    if (product.consistency !== 'consistent') {
      excluded.conflictedHistory[store]++
      continue
    }
    const first = product.captures[0]
    const name = nameSignature(first.name)
    const pack = unitSignature(first.pack)
    if (!name || !pack) {
      excluded.incomparablePackOrName[store]++
      continue
    }
    const signature = JSON.stringify([name, pack])
    const found = groups.get(signature) ?? []
    found.push(product)
    groups.set(signature, found)
    excluded.comparable[store]++
  }
  return groups
}

/**
 * In-memory candidates use private canonical product IDs only; the CLI prints
 * totals without IDs. A human must verify actual product equivalence.
 */
export function proposePrivateCrossRetailerMatches(catalog) {
  // Reuse the existing deep, fail-closed canonical catalog validator:
  // exact source hosts, dates, facts, history consistency, no source rights.
  comparePrivateRetailerCatalogs(catalog, catalog)
  const excluded = {
    conflictedHistory: { plus: 0, dekamarkt: 0 },
    incomparablePackOrName: { plus: 0, dekamarkt: 0 },
    comparable: { plus: 0, dekamarkt: 0 },
  }
  const plus = keyed(catalog.products, 'plus', excluded)
  const deka = keyed(catalog.products, 'dekamarkt', excluded)
  const keys = [...plus.keys()].filter(key => deka.has(key)).sort()
  const candidatePairs = []
  let ambiguousGroups = 0
  let ambiguousProducts = 0
  for (const key of keys) {
    const a = plus.get(key)
    const b = deka.get(key)
    if (a.length !== 1 || b.length !== 1) {
      ambiguousGroups++
      ambiguousProducts += a.length + b.length
      continue
    }
    if (candidatePairs.length >= MAX_CANDIDATES) fail()
    const p = a[0]
    const q = b[0]
    if (!validId(p.retailerProductId) || !validId(q.retailerProductId)) fail()
    candidatePairs.push({
      plusProductKey: p.canonicalKey,
      dekamarktProductKey: q.canonicalKey,
      evidence: 'offline-exact-normalized-name-and-physical-pack-only',
      status: 'human-review-required',
      verifiedEquivalent: false,
      verifiedPriceMatch: false,
      priceComparisonCents: null,
    })
  }
  candidatePairs.sort((a,b) =>
    a.plusProductKey.localeCompare(b.plusProductKey) ||
    a.dekamarktProductKey.localeCompare(b.dekamarktProductKey))
  return {
    schemaVersion: 1,
    mode: 'private-cross-retailer-candidate-review',
    candidateCount: candidatePairs.length,
    ambiguousGroups,
    ambiguousProducts,
    excluded,
    candidatePairs,
    humanReviewRequired: true,
    verifiedEquivalentProducts: 0,
    priceComparisonsAvailable: false,
    permissionVerified: false,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
    externalRequests: 0,
  }
}

export async function main(argv = process.argv.slice(2), write = data => process.stdout.write(data)) {
  if (!Array.isArray(argv) || argv.length !== 0) fail()
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  const result = proposePrivateCrossRetailerMatches(catalog)
  // Never print even private product IDs to shared CI/operator stdout.
  const { candidatePairs: _privatePairs, ...summary } = result
  write(JSON.stringify(summary, null, 2) + '\n')
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private cross-retailer matching review refused')
    process.exitCode = 2
  })
}
