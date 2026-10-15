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
 * Only a concrete, purchase-ready price can be used as the cost of one pack.
 * AggregateOffer.lowPrice is a range minimum (not an individual offer) and a
 * UnitPriceSpecification is normally a reference price (e.g. EUR/kg), which
 * cannot be multiplied by the number of packs at checkout.
 *
 * Keep unknown prices null rather than creating a fictitious basket winner.
 */
/**
 * A Schema.org reference price is a checkout pack price only if the stated
 * referenceQuantity equals the Product's physical package. For example 1000
 * MLT on a 1000 ml carton is exact; 1 KGM or 500 MLT is not. Keep non-
 * equivalent and untyped references unknown rather than scaling a rate.
 */
function samePhysicalReference(reference: unknown, pack: RawPack): boolean {
  if (!isObject(reference) || pack.amount === null) return false
  const unitCode = asString(reference.unitCode)?.toUpperCase()
  const normalizedUnit: Record<string, RawPack['unit']> = {
    GRM: 'g', KGM: 'kg', MLT: 'ml', LTR: 'l', C62: 'piece',
  }
  const unit = unitCode ? normalizedUnit[unitCode] : undefined
  const value = asString(reference.value)
  if (!unit || !value || !/^[0-9]+(?:[.,][0-9]+)?$/.test(value)) return false
  const parsed = Number(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return false

  const amount = (quantity: number, physicalUnit: RawPack['unit']) => {
    if (physicalUnit === 'g' || physicalUnit === 'ml' || physicalUnit === 'piece') return quantity
    if (physicalUnit === 'kg' || physicalUnit === 'l') return quantity * 1000
    return null
  }
  const family = (physicalUnit: RawPack['unit']) =>
    physicalUnit === 'g' || physicalUnit === 'kg' ? 'mass'
      : physicalUnit === 'ml' || physicalUnit === 'l' ? 'volume'
        : physicalUnit === 'piece' ? 'piece' : 'unknown'
  // ReferenceQuantity is for the entire purchasable SKU, not one inner
  // carton of a multipack. The checkout price for "2 x 500 ml" must only be
  // inferred from a physically equivalent 1000 ml (or 1 LTR) reference.
  // Refuse uncertain labels/counts instead of treating an inner unit as a SKU.
  const physicalPack = normalizePackText(pack.rawText)
  if (physicalPack.amount !== pack.amount ||
      physicalPack.unit !== pack.unit ||
      !Number.isSafeInteger(physicalPack.count) || physicalPack.count <= 0) {
    return false
  }
  const packAmount = amount(pack.amount * physicalPack.count, pack.unit)
  const refAmount = amount(parsed, unit)
  return family(pack.unit) !== 'unknown' && family(pack.unit) === family(unit) &&
    packAmount !== null && refAmount !== null &&
    Number.isSafeInteger(packAmount) && Number.isSafeInteger(refAmount) &&
    packAmount === refAmount
}

/**
 * Bound quoted prices by REAL calendar dates, never Date.parse's permissive
 * rollover (2026-02-30 => March 2). This applies to Offer and nested
 * PriceSpecification windows before they can become checkout evidence.
 */
function priceBoundTime(raw: string, isEnd: boolean): number {
  const date = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(raw)
  if (!date) return Number.NaN
  const year = Number(date[1])
  const month = Number(date[2])
  const day = Number(date[3])
  const calendar = new Date(0)
  calendar.setUTCHours(0, 0, 0, 0)
  calendar.setUTCFullYear(year, month - 1, day)
  if (year < 1 || calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return Number.NaN
  }

  const suffix = raw.slice(10)
  if (suffix) {
    const timestamp = /^T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.][0-9]{1,9})?)?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(suffix)
    if (!timestamp) return Number.NaN
    const hour = Number(timestamp[1])
    const minute = Number(timestamp[2])
    const second = Number(timestamp[3] ?? '0')
    if (hour > 23 || minute > 59 || second > 59) return Number.NaN
    const zone = timestamp[4]
    if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 ||
        Number(zone.slice(4, 6)) > 59)) return Number.NaN
  }
  return Date.parse(isEnd && !suffix ? raw + 'T23:59:59.999Z' : raw)
}

function exactSpecPrice(specification: JsonObject, pack: RawPack): number | null {
  if (hasType(specification, 'UnitPriceSpecification') ||
      specification.referenceQuantity !== undefined) {
    if (!hasType(specification, 'UnitPriceSpecification') ||
        !samePhysicalReference(specification.referenceQuantity, pack)) {
      return null
    }
  }
  return cents(specification.price)
}

function specificationValidAt(specification: JsonObject, observedAt: number): boolean {
  const fields = [
    [specification.validFrom, false],
    [specification.validThrough ?? specification.validTo, true],
  ] as const
  for (const [raw, isEnd] of fields) {
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string' || !raw.trim()) return false
    const value = priceBoundTime(raw, isEnd)
    if (!Number.isFinite(value) ||
        (isEnd ? value < observedAt : value > observedAt)) return false
  }
  const from = specification.validFrom
  const to = specification.validThrough ?? specification.validTo
  return from == null || to == null ||
    priceBoundTime(from as string, false) <= priceBoundTime(to as string, true)
}

/** Never promote a multi-Offer collection to a single unbounded checkout quote. */
function extractPrice(offers: JsonObject[], pack: RawPack, capturedAt: string): number | null {
  if (offers.length !== 1 || hasType(offers[0], 'AggregateOffer')) return null
  const offer = offers[0]
  const capturedMs = Date.parse(capturedAt)
  if (!Number.isFinite(capturedMs)) return null
  const prices = [
    cents(offer.price),
    ...priceSpecificationCandidates(offer).map((spec) =>
      specificationValidAt(spec, capturedMs) ? exactSpecPrice(spec, pack) : null),
  ].filter((value): value is number => value !== null)
  return uniqueKnown(prices)
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

/**
 * Preserve the time interval of the actual price source. Intersect matching
 * nested PriceSpecification windows with the containing Offer window.
 * Otherwise a valid-at-capture quote could appear valid long after expiry.
 */
function buildOffer(offers: JsonObject[], price: number | null, pack: RawPack,
  capturedAt: string): RawOffer | null {
  if (offers.length !== 1 || price === null) return null
  const offer = offers[0]
  const capturedMs = Date.parse(capturedAt)
  const specs = priceSpecificationCandidates(offer)
    .filter((spec) => exactSpecPrice(spec, pack) === price &&
      specificationValidAt(spec, capturedMs))

  const fromDates: string[] = []
  const toDates: string[] = []
  const add = (value: unknown, end: boolean) => {
    if (typeof value === 'string' && value.trim()) {
      (end ? toDates : fromDates).push(value.trim())
    }
  }
  add(offer.validFrom, false)
  add(offer.priceValidUntil, true)
  for (const spec of specs) {
    add(spec.validFrom, false)
    add(spec.validThrough ?? spec.validTo, true)
  }
  const validFrom = fromDates.sort((a, b) =>
    priceBoundTime(b, false) - priceBoundTime(a, false))[0] ?? null
  const validTo = toDates.sort((a, b) =>
    priceBoundTime(a, true) - priceBoundTime(b, true))[0] ?? null

  return {
    label: 'schema.org Offer', mechanics: null, offerPriceCents: price,
    originalPriceCents: null, validFrom,
    validTo: validTo && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(validTo)
      ? validTo + 'T23:59:59.999Z' : validTo,
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
  // An explicitly malformed Offer window is invalid SOURCE evidence, not an
  // ordinary unknown/missing price. Preserve the parser's abstain contract.
  for (const offer of offers) {
    for (const [field, isEnd] of [
      ['validFrom', false], ['priceValidUntil', true],
    ] as const) {
      const value = offer[field]
      if (value === null || value === undefined) continue
      if (typeof value !== 'string' || !value.trim() ||
          !Number.isFinite(priceBoundTime(value, isEnd))) {
        return { type: 'abstain',
          reason: 'Product JSON-LD observation failed trust validation: ' +
            'Offer ' + field + ' must be a valid date/timestamp' }
      }
    }
  }
  const currency = extractCurrency(offers)
  if (currency !== null && currency !== 'EUR') {
    return {
      type: 'abstain',
      reason: `Product JSON-LD currency is not EUR: ${currency}`,
    }
  }

  const pack = extractPack(product)
  const price = extractPrice(offers, pack, provenance.capturedAt)
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
    offer: buildOffer(offers, price, pack, provenance.capturedAt),
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
