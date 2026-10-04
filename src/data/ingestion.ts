export type SupermarketId = 'ah' | 'plus'

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
}

function validateSnapshotRef(
  observationSupermarket: SupermarketId,
  provenance: SourceSnapshotRef,
) {
  if (provenance.supermarket !== observationSupermarket) {
    throw new Error(
      'Product observation supermarket must match provenance supermarket',
    )
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

  if (!Number.isFinite(Date.parse(provenance.capturedAt))) {
    throw new Error('Product observation provenance must include a valid capturedAt')
  }

  if (!/^[a-f0-9]{64}$/.test(provenance.sha256)) {
    throw new Error('Product observation provenance must include a SHA-256')
  }
}

/**
 * Minimal M1 trust gate for source adapters.
 *
 * This intentionally validates provenance and money shape only. Source-specific
 * parsers remain responsible for deciding whether a field can be extracted
 * from observed markup; uncertain values should stay null/unknown rather than
 * being guessed.
 */
export function validateRawProductObservation(
  observation: RawProductObservation,
): RawProductObservation {
  if (!observation.name.trim()) {
    throw new Error('Product observation must have a non-empty name')
  }

  validateSnapshotRef(observation.supermarket, observation.provenance)

  if (
    observation.currentPriceCents !== null &&
    (!Number.isInteger(observation.currentPriceCents) ||
      observation.currentPriceCents < 0)
  ) {
    throw new Error('Current price must be null or a non-negative integer cent value')
  }

  if (
    observation.offer?.offerPriceCents !== null &&
    observation.offer?.offerPriceCents !== undefined &&
    (!Number.isInteger(observation.offer.offerPriceCents) ||
      observation.offer.offerPriceCents < 0)
  ) {
    throw new Error('Offer price must be null or a non-negative integer cent value')
  }

  if (
    observation.offer?.originalPriceCents !== null &&
    observation.offer?.originalPriceCents !== undefined &&
    (!Number.isInteger(observation.offer.originalPriceCents) ||
      observation.offer.originalPriceCents < 0)
  ) {
    throw new Error(
      'Original price must be null or a non-negative integer cent value',
    )
  }

  return observation
}
