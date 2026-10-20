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

function priceSpecificationCandidates(offer: JsonObject): JsonObject[] {
  const raw = offer.priceSpecification
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  return values.filter((value): value is JsonObject => isObject(value))
}

/**
 * Schema.org JSON-LD may contain case-variant keys on the same typed Offer.
 * Do not silently trust the first spelling when a second spelling asserts
 * a different financial, currency or stock fact. This is still source
 * evidence, never an independent retailer-price verification.
 */
/**
 * Explicitly malformed prices are not absent prices. A second typed Offer
 * or an auxiliary PriceSpecification cannot be silently discarded while a
 * well-formed amount on the same product is still proposed to the user.
 */
function malformedDeclaredOfferPrice(offers: JsonObject[]): boolean {
  for (const offer of offers) {
    const specifications = priceSpecificationCandidates(offer)
    const rawSpecification = offer.priceSpecification
    if (rawSpecification !== undefined && rawSpecification !== null &&
        (Array.isArray(rawSpecification)
          ? rawSpecification.some(value => !isObject(value))
          : !isObject(rawSpecification))) return true
    for (const source of [offer, ...specifications]) {
      for (const [key, value] of Object.entries(source)) {
        const field = key.toLocaleLowerCase('en')
        if (field !== 'price' && field !== 'lowprice') continue
        const amount = cents(value)
        if (amount === null || !Number.isSafeInteger(amount) || amount < 0) return true
      }
    }
  }
  return false
}

function conflictingOfferEvidence(offers: JsonObject[]): boolean {
  const facts = ['price', 'lowprice', 'pricecurrency', 'availability'] as const
  for (const offer of offers) {
    for (const fact of facts) {
      const entries = Object.entries(offer)
        .filter(([key]) => key.toLocaleLowerCase('en') === fact)
      if (entries.length < 2) continue
      const values = entries.map(([, raw]) => fact === 'price' || fact === 'lowprice'
        ? cents(raw)
        : asString(raw)?.toLocaleLowerCase('en') ?? null)
      if (values.some(value => value === null) ||
          new Set(values).size !== 1) return true
    }

    // Case variants of a lowPrice range remain evidence even though they can
    // NEVER themselves serve as the pack price. They must not contradict the
    // one concrete Offer.price or its parallel alias.
    const prices = Object.entries(offer)
      .filter(([key]) => key.toLocaleLowerCase('en') === 'price')
      .map(([, value]) => cents(value))
    const ranges = Object.entries(offer)
      .filter(([key]) => key.toLocaleLowerCase('en') === 'lowprice')
      .map(([, value]) => cents(value))
    if (prices.length && ranges.length &&
        [...prices, ...ranges].some(value => value === null ||
          value !== prices[0])) return true

    // Source currencies also have to agree with any explicit case-variant
    // priceSpecification currency. Do not silently prefer the familiar key.
    const currencyClaims = [
      ...Object.entries(offer)
        .filter(([key]) => key.toLocaleLowerCase('en') === 'pricecurrency'),
      ...priceSpecificationCandidates(offer).flatMap(specification =>
        Object.entries(specification).filter(([key]) =>
          key.toLocaleLowerCase('en') === 'pricecurrency')),
    ].map(([, value]) => asString(value)?.toUpperCase() ?? null)
    if (currencyClaims.length && (currencyClaims.some(value => value === null) ||
        new Set(currencyClaims).size > 1)) return true
  }
  return false
}

function extractPrice(offers: JsonObject[]): number | null {
  // AggregateOffer.lowPrice and ranges describe many offers, not the
  // payable price of this exact SKU/pack. Multiple offers or a unit-price
  // specification cannot independently prove a checkout package price.
  // An unambiguous concrete typed Offer.price is the only price authority.
  if (offers.length !== 1 || !hasType(offers[0], 'Offer') ||
      hasType(offers[0], 'AggregateOffer')) return null
  return cents(offers[0].price)
}

function extractCurrency(offers: JsonObject[]): string | null {
  const currencies = offers
    .flatMap((offer) => [
      asString(offer.priceCurrency),
      ...priceSpecificationCandidates(offer).map((specification) =>
        asString(specification.priceCurrency),
      ),
    ])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase())
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
    .map((offer) => asString(offer.availability))
    .filter((value): value is string => Boolean(value))

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
  if (!isObject(provenance)) {
    return {
      type: 'abstain',
      reason: 'Product JSON-LD provenance must be an object',
    }
  }

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
  if (malformedDeclaredOfferPrice(offers)) {
    return { type: 'abstain', reason: 'malformed declared Offer or PriceSpecification amount' }
  }
  if (conflictingOfferEvidence(offers)) {
    return { type: 'abstain', reason: 'contradictory price, currency or availability on the same Schema.org Offer' }
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
