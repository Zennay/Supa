import { validateRawProductObservation } from '../src/data/ingestion.ts'

// All source formats are normalized by the existing strict retailer adapters
// BEFORE entering this unified internal schema. This registry NEVER claims a
// licensed/public catalog, and never merges two retailers by a fuzzy name.
function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,160}$/.test(value)
}

function normalizedObservation(value) {
  validateRawProductObservation(value)
  if (!safeId(value.sourceProductId)) throw new Error('Unsafe/missing retail product identity')
  // A direct caller must not bypass source trust by providing a structurally
  // valid yet credential-bearing URL, impossible clock or unsafe money value.
  const origin = new URL(value.provenance.url)
  if (origin.username || origin.password || origin.hash ||
      origin.port || origin.searchParams.has('access_token')) {
    throw new Error('Untrusted retailer capture source URL')
  }
  const captured = Date.parse(value.provenance.capturedAt)
  if (!Number.isFinite(captured) || captured > Date.now()) {
    throw new Error('Future or invalid retailer capture instant')
  }
  const safeCents = n => n === null ||
    (Number.isSafeInteger(n) && n >= 0)
  if (!safeCents(value.currentPriceCents) ||
      (value.offer && (!safeCents(value.offer.offerPriceCents) ||
        !safeCents(value.offer.originalPriceCents)))) {
    throw new Error('Untrusted retailer capture cent amount')
  }
  return {
    sourceKind: value.provenance.kind,
    snapshotSha256: value.provenance.sha256,
    sourceUrl: value.provenance.url,
    capturedAt: value.provenance.capturedAt,
    name: value.name,
    currentPriceCents: value.currentPriceCents,
    currency: value.currency,
    pack: { ...value.pack },
    offer: value.offer === null ? null : { ...value.offer },
    availability: value.availability,
  }
}

function truthSignature(record) {
  // Category/source kind and capture time are NOT authority to silently choose
  // between unequal prices, packs or availability.
  return JSON.stringify([
    record.name, record.currentPriceCents, record.currency,
    record.pack, record.offer, record.availability,
  ])
}

export function buildUniversalRetailerCatalog(batch) {
  if (!batch || typeof batch !== 'object' ||
      batch.summary?.mode !== 'reviewed-offline-only' ||
      !Array.isArray(batch.results) || batch.results.length > 32 ||
      batch.results.length === 0) {
    throw new Error('Only bounded reviewed offline ingestion batches are accepted')
  }
  // Direct JS consumers bypass the canonical ingest constructor. Never allow
  // a seemingly successful private catalog built from forged summary claims.
  // Some internal callers use { mode } only: missing optional fields remain
  // intentionally supported, but any supplied field must agree with facts.
  const summary = batch.summary
  for (const key of ['productionEnabled', 'permissionVerified',
    'publicSavingsClaimEligible']) {
    if (Object.hasOwn(summary, key) && summary[key] !== false) {
      throw new Error('Refusing untrusted retailer batch permission or publication claim')
    }
  }
  const presentCount = (key, actual) => {
    if (Object.hasOwn(summary, key) &&
        (!Number.isSafeInteger(summary[key]) || summary[key] !== actual)) {
      throw new Error('Refusing contradictory retailer batch source/observation count')
    }
  }
  presentCount('sources', batch.results.length)
  presentCount('acceptedSources', batch.results.length)
  presentCount('rejectedSources', 0)
  const actualObservations = batch.results.reduce((sum, result) =>
    sum + (Array.isArray(result?.observations) ? result.observations.length : 0), 0)
  presentCount('observations', actualObservations)
  if (Object.hasOwn(summary, 'retailerCounts')) {
    const counts = summary.retailerCounts
    const expected = { plus: 0, dekamarkt: 0 }
    if (counts === null || typeof counts !== 'object' ||
        Array.isArray(counts) ||
        Object.keys(counts).length !== 2 ||
        !Object.hasOwn(counts, 'plus') || !Object.hasOwn(counts, 'dekamarkt')) {
      throw new Error('Refusing untrusted retailer batch breakdown')
    }
    for (const result of batch.results) {
      if (result?.key?.startsWith('plus:')) expected.plus +=
        Array.isArray(result.observations) ? result.observations.length : 0
      else if (result?.key?.startsWith('dekamarkt:')) expected.dekamarkt +=
        Array.isArray(result.observations) ? result.observations.length : 0
    }
    if (counts.plus !== expected.plus || counts.dekamarkt !== expected.dekamarkt) {
      throw new Error('Refusing contradictory retailer batch breakdown')
    }
  }
  const groups = new Map()
  let observationsCount = 0
  for (const result of batch.results) {
    if (!result || result.accepted !== true ||
        !Array.isArray(result.observations) ||
        result.observations.length === 0 ||
        result.observations.length > 256) {
      throw new Error('Refusing incomplete or untrusted retailer ingest batch')
    }
    for (const observation of result.observations) {
      const normalized = normalizedObservation(observation)
      const scope = observation.supermarket
      if (!['plus', 'dekamarkt'].includes(scope) ||
          result.key !== scope + ':' + normalized.sourceKind) {
        throw new Error('Ingestion result does not match validated retailer adapter')
      }
      const identity = scope + ':' + observation.sourceProductId
      const entries = groups.get(identity) ?? {
        canonicalKey: identity,
        retailerId: scope,
        retailerProductId: observation.sourceProductId,
        captures: [],
      }
      if (entries.captures.some(c => c.snapshotSha256 === normalized.snapshotSha256 &&
          c.sourceKind === normalized.sourceKind &&
          c.sourceUrl === normalized.sourceUrl &&
          c.capturedAt === normalized.capturedAt &&
          truthSignature(c) === truthSignature(normalized))) {
        // Only the exact same physical capture event is idempotent. A
        // different time/URL with identical HTML is independent provenance.
        continue
      }
      entries.captures.push(normalized)
      groups.set(identity, entries)
      observationsCount += 1
    }
  }
  const products = [...groups.values()].map(entry => {
    const captures = entry.captures.sort((a, b) =>
      a.capturedAt.localeCompare(b.capturedAt) ||
      a.snapshotSha256.localeCompare(b.snapshotSha256) ||
      a.sourceKind.localeCompare(b.sourceKind) ||
      a.sourceUrl.localeCompare(b.sourceUrl) ||
      truthSignature(a).localeCompare(truthSignature(b)))
    const facts = new Set(captures.map(truthSignature))
    return {
      ...entry,
      captures,
      consistency: facts.size === 1 ? 'consistent' : 'review-required',
      currentTrustedPriceCents: null,
      selectedSnapshotSha256: null,
      sourceRightsVerified: false,
      publishable: false,
    }
  }).sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey))
  return {
    schemaVersion: 1,
    model: 'universal-retailer-product-captures',
    status: 'private-review-only',
    sourceCount: batch.results.length,
    productCount: products.length,
    captureCount: observationsCount,
    conflictCount: products.filter(product => product.consistency !== 'consistent').length,
    products,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
  }
}
