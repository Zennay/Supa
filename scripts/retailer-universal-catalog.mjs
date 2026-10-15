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
  // Some direct callers intentionally supply only { mode } for a small
  // synthetic offline cohort. If a declared summary field is present,
  // however, its counts/permission status must match the ACTUAL accepted
  // observations. An envelope is never authority for live/public claims.
  const summary = batch.summary
  const optional = (key, predicate) =>
    !Object.hasOwn(summary, key) || predicate(summary[key])
  if (!optional('productionEnabled', x => x === false) ||
      !optional('permissionVerified', x => x === false) ||
      !optional('publicSavingsClaimEligible', x => x === false) ||
      !optional('sources', x => Number.isSafeInteger(x) && x === batch.results.length) ||
      !optional('acceptedSources', x => Number.isSafeInteger(x) && x === batch.results.length) ||
      !optional('rejectedSources', x => x === 0)) {
    throw new Error('Refusing contradictory private retailer batch summary')
  }
  let rawObservationTotal = 0
  const sourceObservations = { plus: 0, dekamarkt: 0 }
  for (const result of batch.results) {
    if (!result || result.accepted !== true || !Array.isArray(result.observations) ||
        result.observations.length < 1 || result.observations.length > 256 ||
        typeof result.key !== 'string' ||
        !/^(plus|dekamarkt):(product|catalog|offers)$/.test(result.key)) {
      throw new Error('Refusing incomplete or untrusted private retailer batch source')
    }
    const store = result.key.split(':', 1)[0]
    rawObservationTotal += result.observations.length
    sourceObservations[store] += result.observations.length
  }
  if (!optional('observations', x => Number.isSafeInteger(x) && x === rawObservationTotal) ||
      !optional('retailerCounts', x =>
        x && typeof x === 'object' && !Array.isArray(x) &&
        Object.keys(x).length === 2 &&
        Object.hasOwn(x, 'plus') && Object.hasOwn(x, 'dekamarkt') &&
        x.plus === sourceObservations.plus &&
        x.dekamarkt === sourceObservations.dekamarkt)) {
    throw new Error('Refusing inconsistent private retailer batch counters')
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
