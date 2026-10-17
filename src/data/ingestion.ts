export type SupermarketId = 'ah' | 'plus' | 'dekamarkt'

export type SourcePageKind = 'product' | 'catalog' | 'offers'

export type SourceSnapshotRef = {
  supermarket: SupermarketId
  kind: SourcePageKind
  url: string
  capturedAt: string
  sha256: string
}

export type PackUnit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'piece'
  | 'pack'
  | 'unknown'

export type RawPack = {
  rawText: string | null
  amount: number | null
  unit: PackUnit
}

export type RawOffer = {
  label: string
  mechanics: string | null
  offerPriceCents: number | null
  originalPriceCents: number | null
  validFrom: string | null
  validTo: string | null
}

export type RawProductObservation = {
  supermarket: SupermarketId
  sourceProductId: string | null
  name: string
  currentPriceCents: number | null
  currency: 'EUR'
  pack: RawPack
  offer: RawOffer | null
  availability: 'available' | 'unavailable' | 'unknown'
  provenance: SourceSnapshotRef
}

const HOST_BY_SUPERMARKET: Record<SupermarketId, string> = {
  ah: 'www.ah.nl',
  plus: 'www.plus.nl',
  dekamarkt: 'www.dekamarkt.nl',
}

const SOURCE_PAGE_KINDS = new Set<SourcePageKind>([
  'product',
  'catalog',
  'offers',
])

const PACK_UNITS = new Set<PackUnit>([
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'pack',
  'unknown',
])

const AVAILABILITY_VALUES = new Set([
  'available',
  'unavailable',
  'unknown',
])

function isSupermarketId(value: unknown): value is SupermarketId {
  return value === 'ah' || value === 'plus' || value === 'dekamarkt'
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/**
 * Physical offer validity clock, independent from the source capturedAt gate.
 *
 * Date.parse silently normalizes impossible calendar days on some platforms
 * and discards nanoseconds 4–9. A 1ns-reversed offer must not be admitted as
 * reviewed data. Date-only windows keep their established UTC-midnight meaning;
 * valid future offer windows remain allowed (source capture uses a separate gate).
 */
function offerInstantNanoseconds(value: unknown): bigint | null {
  if (typeof value !== 'string') return null
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  // setUTCFullYear avoids Date.UTC's surprising 1900-based years 0–99.
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  calendar.setUTCHours(0, 0, 0, 0)
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) return null

  const hour = Number(match[4] ?? 0)
  const minute = Number(match[5] ?? 0)
  const second = Number(match[6] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) return null

  const zone = match[8] ?? 'Z'
  let offsetMinutes = 0
  if (zone !== 'Z') {
    const zoneHour = Number(zone.slice(1, 3))
    const zoneMinute = Number(zone.slice(4, 6))
    if (zoneHour > 14 || zoneMinute > 59 ||
        (zoneHour === 14 && zoneMinute !== 0)) return null
    offsetMinutes = (zone[0] === '+' ? 1 : -1) *
      (zoneHour * 60 + zoneMinute)
  }

  const milliseconds = calendar.getTime() +
    (hour * 60 * 60 + minute * 60 + second) * 1000 -
    offsetMinutes * 60_000
  if (!Number.isFinite(milliseconds)) return null
  return BigInt(milliseconds) * 1_000_000n +
    BigInt((match[7] ?? '').padEnd(9, '0'))
}

function validateNullableMoneyCents(value: unknown, label: string) {
  if (
    value !== null &&
    (!Number.isInteger(value) || (value as number) < 0)
  ) {
    throw new Error(
      `${label} must be null or a non-negative integer cent value`,
    )
  }
}

function validateSnapshotRef(
  observationSupermarket: SupermarketId,
  provenance: SourceSnapshotRef,
) {
  if (!provenance || typeof provenance !== 'object') {
    throw new Error('Product observation must include source provenance')
  }

  if (!isSupermarketId(provenance.supermarket)) {
    throw new Error('Product observation provenance has an unknown supermarket')
  }

  if (provenance.supermarket !== observationSupermarket) {
    throw new Error(
      'Product observation supermarket must match provenance supermarket',
    )
  }

  if (!SOURCE_PAGE_KINDS.has(provenance.kind)) {
    throw new Error('Product observation provenance has an unknown source kind')
  }

  let url: URL
  try {
    url = new URL(provenance.url)
  } catch {
    throw new Error('Product observation provenance must contain a valid URL')
  }

  const expectedHost = HOST_BY_SUPERMARKET[observationSupermarket]
  if (url.protocol !== 'https:' || url.hostname !== expectedHost) {
    throw new Error(
      `Product observation provenance must use HTTPS on ${expectedHost}`,
    )
  }

  if (!validIso(provenance.capturedAt)) {
    throw new Error('Product observation provenance must include a valid capturedAt')
  }

  if (!/^[a-f0-9]{64}$/.test(provenance.sha256)) {
    throw new Error('Product observation provenance must include a SHA-256')
  }
}

function validatePack(pack: RawPack) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('Product observation must include a pack object')
  }

  if (
    pack.rawText !== null &&
    (typeof pack.rawText !== 'string' || !pack.rawText.trim())
  ) {
    throw new Error('Pack rawText must be null or a non-empty string')
  }

  if (
    pack.amount !== null &&
    (typeof pack.amount !== 'number' ||
      !Number.isFinite(pack.amount) ||
      pack.amount <= 0)
  ) {
    throw new Error('Pack amount must be null or a positive finite number')
  }

  if (!PACK_UNITS.has(pack.unit)) {
    throw new Error('Pack unit must use a supported unit')
  }
}

function validateOffer(offer: RawOffer | null) {
  if (offer === null) return
  if (!offer || typeof offer !== 'object') {
    throw new Error('Offer must be null or an offer object')
  }

  if (typeof offer.label !== 'string' || !offer.label.trim()) {
    throw new Error('Offer label must be a non-empty string')
  }

  if (
    offer.mechanics !== null &&
    (typeof offer.mechanics !== 'string' || !offer.mechanics.trim())
  ) {
    throw new Error('Offer mechanics must be null or a non-empty string')
  }

  validateNullableMoneyCents(offer.offerPriceCents, 'Offer price')
  validateNullableMoneyCents(offer.originalPriceCents, 'Original price')

  const validFrom = offer.validFrom === null
    ? null : offerInstantNanoseconds(offer.validFrom)
  const validTo = offer.validTo === null
    ? null : offerInstantNanoseconds(offer.validTo)
  if (offer.validFrom !== null && validFrom === null) {
    throw new Error('Offer validFrom must be null or a valid date/timestamp')
  }
  if (offer.validTo !== null && validTo === null) {
    throw new Error('Offer validTo must be null or a valid date/timestamp')
  }
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    throw new Error('Offer validity window cannot end before it starts')
  }
}

/**
 * Minimal M1 trust gate for source adapters.
 *
 * Runtime validation matters because reviewed live fixtures enter as JSON, not
 * as compile-time TypeScript values. Uncertain source fields should stay
 * null/unknown; malformed enum, pack, offer or provenance values must fail
 * before downstream normalization/matching can trust them.
 */
export function validateRawProductObservation(
  observation: RawProductObservation,
): RawProductObservation {
  if (!observation || typeof observation !== 'object') {
    throw new Error('Product observation must be an object')
  }

  if (!isSupermarketId(observation.supermarket)) {
    throw new Error('Product observation has an unknown supermarket')
  }

  if (
    observation.sourceProductId !== null &&
    (typeof observation.sourceProductId !== 'string' ||
      !observation.sourceProductId.trim())
  ) {
    throw new Error(
      'Product observation sourceProductId must be null or a non-empty string',
    )
  }

  if (typeof observation.name !== 'string' || !observation.name.trim()) {
    throw new Error('Product observation must have a non-empty name')
  }

  if (observation.currency !== 'EUR') {
    throw new Error('Product observation currency must be EUR')
  }

  if (!AVAILABILITY_VALUES.has(observation.availability)) {
    throw new Error('Product observation has an unknown availability state')
  }

  validatePack(observation.pack)
  validateOffer(observation.offer)
  validateSnapshotRef(observation.supermarket, observation.provenance)
  validateNullableMoneyCents(observation.currentPriceCents, 'Current price')

  return observation
}
