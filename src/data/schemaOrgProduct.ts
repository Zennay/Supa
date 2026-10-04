import type {
  RawOffer,
  RawPack,
  RawProductObservation,
  SourceSnapshotRef,
} from './ingestion'
import { validateRawProductObservation } from './ingestion'
import { normalizeMoneyToCents } from './normalize'

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

function extractPrice(offers: JsonObject[]): number | null {
  const prices = offers
    .map((offer) => cents(offer.price ?? offer.lowPrice))
    .filter((value): value is number => value !== null)
  return uniqueKnown(prices)
}

function extractCurrency(offers: JsonObject[]): string | null {
  const currencies = offers
    .map((offer) => asString(offer.priceCurrency))
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase())
  return uniqueKnown(currencies)
}

function extractAvailability(
  offers: JsonObject[],
): RawProductObservation['availability'] {
  const values = offers
    .map((offer) => asString(offer.availability))
    .filter((value): value is string => Boolean(value))
    .map((value) => value.split('/').pop()?.toLowerCase() ?? value.toLowerCase())

  const unique = [...new Set(values)]
  if (unique.length !== 1) return 'unknown'
  if (unique[0] === 'instock' || unique[0] === 'limitedavailability') {
    return 'available'
  }
  if (unique[0] === 'outofstock' || unique[0] === 'soldout') {
    return 'unavailable'
  }
  return 'unknown'
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
  const currency = extractCurrency(offers)
  if (currency !== null && currency !== 'EUR') {
    return {
      type: 'abstain',
      reason: `Product JSON-LD currency is not EUR: ${currency}`,
    }
  }

  const price = extractPrice(offers)
  const observation: RawProductObservation = {
    supermarket: provenance.supermarket,
    sourceProductId: extractSourceProductId(product),
    name,
    currentPriceCents: price,
    currency: 'EUR',
    pack: unknownPack(),
    offer: buildOffer(offers, price),
    availability: extractAvailability(offers),
    provenance,
  }

  return {
    type: 'observation',
    observation: validateRawProductObservation(observation),
  }
}
