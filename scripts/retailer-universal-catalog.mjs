import { validateRawProductObservation } from '../src/data/ingestion.ts'

// All source formats are normalized by the existing strict retailer adapters
// BEFORE entering this unified internal schema. This registry NEVER claims a
// licensed/public catalog, and never merges two retailers by a fuzzy name.
/**
 * Direct callers can bypass six strict source adapters. Admit only real civil
 * ISO clocks and compare PHYSICAL capture instants, including 1–9 decimal
 * digits that Date.parse would otherwise truncate below milliseconds.
 * This remains an offline provenance check, never permission to use prices.
 */
function physicalCaptureNanoseconds(capturedAt) {
  const parts = typeof capturedAt === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(capturedAt)
    : null
  if (!parts) throw new Error('Invalid retailer capture calendar or timestamp')
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3])
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day ||
      Number(parts[4]) > 23 || Number(parts[5]) > 59 ||
      Number(parts[6] ?? 0) > 59) {
    throw new Error('Invalid retailer capture calendar or timestamp')
  }
  const timezone = parts[8]
  if (timezone !== 'Z') {
    const [hours, minutes] = timezone.slice(1).split(':').map(Number)
    const maximum = timezone[0] === '-' ? 12 : 14
    if (hours > maximum || minutes > 59 || (hours === maximum && minutes !== 0)) {
      throw new Error('Invalid retailer capture UTC offset')
    }
  }
  const millis = Date.parse(capturedAt)
  if (!Number.isFinite(millis)) throw new Error('Invalid retailer capture instant')
  const fractional = (parts[7] ?? '').padEnd(9, '0')
  const nanos = BigInt(millis) * 1_000_000n +
    BigInt(fractional.slice(3) || '0')
  if (nanos > BigInt(Date.now()) * 1_000_000n) {
    throw new Error('Future retailer capture instant')
  }
  return nanos
}

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
  // Strict direct API admission: Date.parse alone normalizes impossible
  // days such as February 30 and drops submillisecond source chronology.
  physicalCaptureNanoseconds(value.provenance.capturedAt)
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
    const captures = entry.captures.sort((a, b) => {
      const aTime = physicalCaptureNanoseconds(a.capturedAt)
      const bTime = physicalCaptureNanoseconds(b.capturedAt)
      return (aTime < bTime ? -1 : aTime > bTime ? 1 : 0) ||
      a.capturedAt.localeCompare(b.capturedAt) ||
      a.snapshotSha256.localeCompare(b.snapshotSha256) ||
      a.sourceKind.localeCompare(b.sourceKind) ||
      a.sourceUrl.localeCompare(b.sourceUrl) ||
      truthSignature(a).localeCompare(truthSignature(b))
    })
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
