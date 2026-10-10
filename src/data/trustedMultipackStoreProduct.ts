import type { RawProductObservation, SupermarketId } from './ingestion.ts'
import type { StoreProduct } from '../domain/basket.ts'
import { projectTrustedObservationPack } from './trustedMultipackCandidate.ts'

/**
 * Opt-in projection of a VERIFIED-SHAPE product observation to one controlled
 * basket candidate. This code never acquires retailer data or grants source
 * reuse permission. It is not wired into live ingestion or the M3 field study.
 *
 * Strictness is deliberate: a pack-only projection is not proof of stock,
 * current per-pack price, a stable product ID or promotion economics.
 */
export type ControlledSourceStore = Readonly<{
  id: string
  supermarket: SupermarketId
}>

const SAFE_KEY = /^[a-z0-9][a-z0-9_-]{1,127}$/

export function projectTrustedObservationForBasket(
  observation: RawProductObservation,
  store: ControlledSourceStore,
): StoreProduct | null {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return null
  if (typeof store.id !== 'string' || !SAFE_KEY.test(store.id)) return null
  if (
    store.supermarket !== 'ah' &&
    store.supermarket !== 'plus' &&
    store.supermarket !== 'dekamarkt'
  ) return null
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return null
  }

  // A catalog or offer listing may not establish product-level pack pricing.
  // Promotions have basket-dependent mechanics. Never silently flatten their
  // label/offerPrice into a universally valid price per pack.
  if (
    observation.supermarket !== store.supermarket ||
    observation.provenance?.kind !== 'product' ||
    observation.offer !== null ||
    observation.availability !== 'available' ||
    typeof observation.sourceProductId !== 'string' ||
    !SAFE_KEY.test(observation.sourceProductId) ||
    typeof observation.name !== 'string' ||
    !observation.name.trim() ||
    !Number.isSafeInteger(observation.currentPriceCents) ||
    (observation.currentPriceCents as number) < 0
  ) {
    return null
  }

  // This full-observation helper validates the provenance supermarket,
  // exact HTTPS retailer host, SHA256 and coherent raw amount/unit/count.
  // Invalid observations must fail closed rather than become cheap candidates.
  const pack = projectTrustedObservationPack(observation)
  if (pack === null) return null

  return {
    id: `${store.id}:${observation.sourceProductId}`,
    storeId: store.id,
    name: observation.name.trim(),
    priceCents: observation.currentPriceCents as number,
    available: true,
    ...pack,
  }
}
