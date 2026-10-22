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
        if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) return true
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

type ExtractedPrice = {
  cents: number
  evidence: 'offer_price' | 'pack_matched_unit_price'
}

function schemaUnitCode(value: unknown): 'g' | 'kg' | 'ml' | 'l' | null {
  const code = asString(value)?.toUpperCase()
  if (code === 'GRM') return 'g'
  if (code === 'KGM') return 'kg'
  if (code === 'MLT') return 'ml'
  if (code === 'LTR') return 'l'
  return null
}

/**
 * A UnitPriceSpecification is a usable pack price only when its explicit
 * reference quantity exactly matches the product's declared pack quantity.
 * Never multiply a per-unit price into a guessed checkout price.
 */
function unitPriceSpecificationMatchesPack(specification: JsonObject, pack: RawPack): boolean {
  if (pack.amount === null || pack.unit === 'unknown') return false
  const reference = specification.referenceQuantity
  if (!isObject(reference)) return false
  const value = asString(reference.value)
  const unit = schemaUnitCode(reference.unitCode)
  if (!value || !unit) return false
  const normalized = normalizePackText(value + ' ' + unit)
  return normalized.amount !== null &&
    normalized.unit !== 'unknown' &&
    normalized.amount === pack.amount &&
    normalized.unit === pack.unit
}

function extractPrice(offers: JsonObject[], pack: RawPack): ExtractedPrice | null {
  // AggregateOffer ranges and multiple offers cannot prove a checkout price.
  if (offers.length !== 1 || !hasType(offers[0], 'Offer') ||
      hasType(offers[0], 'AggregateOffer')) return null
  const offer = offers[0]
  const directPrice = cents(offer.price)
  const specifications = priceSpecificationCandidates(offer)
  const packMatchedUnitPrices = specifications.filter(specification =>
    hasType(specification, 'UnitPriceSpecification') &&
    unitPriceSpecificationMatchesPack(specification, pack))

  if (directPrice !== null) {
    // A unit-price declaration for this exact pack must not contradict the
    // concrete Offer.price. Specifications for a different reference quantity
    // remain unit prices and are never promoted to pack prices.
    if (packMatchedUnitPrices.some(specification => cents(specification.price) !== directPrice)) {
      return null
    }
    return { cents: directPrice, evidence: 'offer_price' }
  }

  // Without Offer.price, accept exactly one explicit EUR unit-price record
  // only when its reference quantity equals the known pack size and unit.
  if (specifications.length !== 1 || packMatchedUnitPrices.length !== 1) return null
  const specification = packMatchedUnitPrices[0]
  const price = cents(specification.price)
  const currency = asString(specification.priceCurrency)?.toUpperCase()
  if (price === null || currency !== 'EUR') return null
  return { cents: price, evidence: 'pack_matched_unit_price' }
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

  const parsePack = (text: string): RawPack | null => {
    const normalized = normalizePackText(text)
    if (normalized.amount === null || normalized.unit === 'unknown') return null
    return { rawText: normalized.rawText, amount: normalized.amount, unit: normalized.unit }
  }

  const direct = parsePack(rawValue)
  const unitFromCode = weight ? schemaUnitCode(weight.unitCode) : null
  const unitText = weight ? asString(weight.unitText) : null
  const fromCode = unitFromCode ? parsePack(rawValue + ' ' + unitFromCode) : null
  const fromUnitText = unitText
    ? (parsePack(unitText) ?? parsePack(rawValue + ' ' + unitText))
    : null
  const candidates = [direct, fromCode, fromUnitText].filter(
    (candidate): candidate is RawPack => candidate !== null,
  )
  if (candidates.length === 0) return unknownPack()

  // Contradictory explicit value/unit evidence is not resolved by choosing
  // whichever field happens to be encountered first.
  const signatures = new Set(candidates.map(candidate => candidate.amount + ':' + candidate.unit))
  if (signatures.size !== 1) return unknownPack()

  const selected = direct ?? fromCode ?? fromUnitText
  if (!selected) return unknownPack()
  return {
    rawText: direct?.rawText ?? (rawValue + ' ' + (unitText ?? unitFromCode ?? '')),
    amount: selected.amount,
    unit: selected.unit,
  }
}

function buildOffer(offers: JsonObject[], price: ExtractedPrice | null): RawOffer | null {
  if (offers.length !== 1 || price === null) return null

  return {
    label: price.evidence === 'offer_price'
      ? 'schema.org Offer'
      : 'schema.org UnitPriceSpecification (pack-matched)',
    mechanics: null,
    offerPriceCents: price.cents,
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

  const pack = extractPack(product)
  const extractedPrice = extractPrice(offers, pack)
  const price = extractedPrice?.cents ?? null
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
    pack,
    offer: buildOffer(offers, extractedPrice),
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
