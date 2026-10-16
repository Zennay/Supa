import type {
  RawOffer,
  RawPack,
  RawProductObservation,
  SourceSnapshotRef,
} from './ingestion.ts'
import { validateRawProductObservation } from './ingestion.ts'
import { normalizeMoneyToCents, normalizePackText } from './normalize.ts'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function schemaTypes(value: unknown): string[] {
  const object = isObject(value) ? value : null
  if (!object) return []
  const raw = object['@type']
  if (Array.isArray(raw)) return raw.map(String)
  return raw == null ? [] : [String(raw)]
}

function hasType(value: unknown, type: string): boolean {
  return schemaTypes(value).some(
    (candidate) => candidate.toLowerCase() === type.toLowerCase(),
  )
}

function productNodes(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(productNodes)
  if (!isObject(value)) return []

  const direct = hasType(value, 'Product') ? [value] : []
  const graph = Array.isArray(value['@graph'])
    ? value['@graph'].flatMap(productNodes)
    : []
  return [...direct, ...graph]
}

function cents(value: unknown): number | null {
  const raw = asString(value)
  if (!raw) return null
  return normalizeMoneyToCents(raw)
}

function offerCandidates(raw: unknown): JsonObject[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  return values.filter(
    (value): value is JsonObject =>
      isObject(value) &&
      (hasType(value, 'Offer') || hasType(value, 'AggregateOffer')),
  )
}

function uniqueKnown<T>(values: T[]): T | null {
  const unique = [...new Set(values)]
  return unique.length === 1 ? unique[0] : null
}

// JSON-LD producers sometimes provide several spellings of the same Schema.org
// property in one object. All explicit declarations are evidence; dropping a
// differently cased sibling can turn a contradictory retail claim into a price.
function caseClaims(node: JsonObject, key: string): unknown[] {
  return Reflect.ownKeys(node)
    .filter((candidate): candidate is string =>
      typeof candidate === 'string' &&
      candidate.toLowerCase() === key.toLowerCase())
    .map((candidate) => {
      const descriptor = Object.getOwnPropertyDescriptor(node, candidate)
      // Non-enumerable accessor claims must not silently disappear. Refuse
      // unreadable evidence without invoking a getter or reflecting its value.
      if (!descriptor || !('value' in descriptor)) {
        throw new Error('unsafe Schema.org evidence property')
      }
      return descriptor.value
    })
}

function priceSpecificationCandidates(offer: JsonObject): JsonObject[] {
  const raw = offer.priceSpecification
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  return values.filter((value): value is JsonObject => isObject(value))
}

// An invalid explicit price is contradictory source evidence, not an absent
// field to filter away while selecting a different valid Offer. Prices in
// each typed Offer and its parallel PriceSpecifications must all be parseable
// into positive whole EUR cents before any private priced observation exists.
function invalidExplicitPriceClaim(offer: JsonObject): boolean {
  const nodes = [offer, ...priceSpecificationCandidates(offer)]
  return nodes.some((node) => {
    const amounts = [...caseClaims(node, 'price'), ...caseClaims(node, 'lowPrice')]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map(cents)
    // Independently valid price/lowPrice amounts are still unusable when they
    // disagree on the same typed Offer or UnitPriceSpecification node.
    return amounts.some((amount) => amount === null || amount <= 0) ||
      new Set(amounts).size > 1
  })
}

function extractPrice(offers: JsonObject[]): number | null {
  if (offers.some(invalidExplicitPriceClaim)) return null
  const prices = offers
    .flatMap((offer) => [offer, ...priceSpecificationCandidates(offer)])
    .flatMap((node) => {
      const explicit = [...caseClaims(node, 'price'), ...caseClaims(node, 'lowPrice')]
      // Uppercase-only Deka SSR Price is not enough to certify a
      // physical pack. Preserve the strict Deka/Nuxt corroboration fallback.
      const canonical = ['price', 'lowPrice'].some((key) => {
        const entry = Object.getOwnPropertyDescriptor(node, key)
        return entry && 'value' in entry &&
          entry.value !== undefined && entry.value !== null && entry.value !== ''
      })
      return canonical ? explicit : []
    })
    .map(cents)
    .filter((value): value is number => value !== null)
  return uniqueKnown(prices)
}

function extractCurrency(offers: JsonObject[]): string | null {
  const currencies = offers
    .flatMap((offer) => [offer, ...priceSpecificationCandidates(offer)])
    .flatMap((node) => caseClaims(node, 'priceCurrency'))
    .map(asString)
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase())
  // Conflicting EUR/GBP or EUR/USD declarations do not imply an absent
  // currency; the caller must abstain instead of selecting the EUR spelling.
  return uniqueKnown(currencies)
}

const SCHEMA_ORG_AVAILABILITY = new Map<
  string,
  RawProductObservation['availability']
>([
  ['instock', 'available'],
  ['limitedavailability', 'available'],
  ['outofstock', 'unavailable'],
  ['soldout', 'unavailable'],
])

export function normalizeSchemaOrgAvailability(
  value: unknown,
): RawProductObservation['availability'] {
  const raw = asString(value)
  if (!raw) return 'unknown'

  const match = /^https?:\/\/schema\.org\/([^/?#]+)\/?$/i.exec(raw)
  if (!match) return 'unknown'

  return SCHEMA_ORG_AVAILABILITY.get(match[1].toLowerCase()) ?? 'unknown'
}

function extractAvailability(
  offers: JsonObject[],
): RawProductObservation['availability'] {
  const explicitValues = offers
    .flatMap((offer) => caseClaims(offer, 'availability'))
  if (explicitValues.length === 0) return 'unknown'

  const values = explicitValues.map(normalizeSchemaOrgAvailability)
  if (values.some((value) => value === 'unknown')) return 'unknown'
  const unique = [...new Set(values)]
  return unique.length === 1 ? unique[0] : 'unknown'
}

function extractSourceProductId(product: JsonObject): string | null {
  for (const key of ['sku', 'gtin13', 'gtin14', 'gtin12', 'gtin']) {
    const value = asString(product[key])
    if (value) return value
  }
  return null
}

function unknownPack(): RawPack {
  return {
    rawText: null,
    amount: null,
    unit: 'unknown',
  }
}

function extractPack(product: JsonObject): RawPack {
  const weight = isObject(product.weight) ? product.weight : null
  const rawValue = weight ? asString(weight.value) : null
  if (!rawValue) return unknownPack()

  const normalized = normalizePackText(rawValue)
  if (normalized.amount === null || normalized.unit === 'unknown') {
    return unknownPack()
  }

  return {
    rawText: normalized.rawText,
    amount: normalized.amount,
    unit: normalized.unit,
  }
}

function buildOffer(offers: JsonObject[], price: number | null): RawOffer | null {
  if (offers.length !== 1 || price === null) return null

  return {
    label: 'schema.org Offer',
    mechanics: null,
    offerPriceCents: price,
    originalPriceCents: null,
    validFrom: asString(offers[0].validFrom),
    validTo: asString(offers[0].priceValidUntil),
  }
}

export type SchemaOrgParseResult =
  | { type: 'observation'; observation: RawProductObservation }
  | { type: 'abstain'; reason: string }

export function parseSchemaOrgProduct(
  jsonLd: unknown,
  provenance: SourceSnapshotRef,
): SchemaOrgParseResult {
  const products = productNodes(jsonLd)

  if (products.length === 0) {
    return { type: 'abstain', reason: 'no Product JSON-LD node' }
  }
  if (products.length > 1) {
    return {
      type: 'abstain',
      reason: 'multiple Product JSON-LD nodes are ambiguous',
    }
  }

  const product = products[0]
  const name = asString(product.name)
  if (!name) {
    return { type: 'abstain', reason: 'Product JSON-LD has no usable name' }
  }

  const offers = offerCandidates(product.offers)
  // An AggregateOffer describes a catalogue or price range, never an
  // observed checkout amount for this physical pack. Its lowPrice cannot
  // corroborate a concrete per-unit price, even if it has one bound, matches
  // a separate Offer by coincidence, or advertises InStock availability.
  if (offers.some((offer) => hasType(offer, 'AggregateOffer'))) {
    return { type: 'abstain', reason: 'AggregateOffer does not certify one physical unit price' }
  }
  const currency = extractCurrency(offers)
  if (currency !== null && currency !== 'EUR') {
    return {
      type: 'abstain',
      reason: `Product JSON-LD currency is not EUR: ${currency}`,
    }
  }

  const price = extractPrice(offers)
  if (price !== null && currency === null) {
    return {
      type: 'abstain',
      reason: 'Product JSON-LD priced offer has no explicit currency',
    }
  }

  const observation: RawProductObservation = {
    supermarket: provenance.supermarket,
    sourceProductId: extractSourceProductId(product),
    name,
    currentPriceCents: price,
    currency: 'EUR',
    pack: extractPack(product),
    offer: buildOffer(offers, price),
    availability: extractAvailability(offers),
    provenance,
  }

  try {
    return {
      type: 'observation',
      observation: validateRawProductObservation(observation),
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'unknown validation failure'
    return {
      type: 'abstain',
      reason: `Product JSON-LD observation failed trust validation: ${message}`,
    }
  }
}
