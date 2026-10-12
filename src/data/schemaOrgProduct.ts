import type {
  RawOffer,
  RawPack,
  RawProductObservation,
  SourceSnapshotRef,
} from './ingestion.ts'
import { validateRawProductObservation } from './ingestion.ts'
import { normalizeMoneyToCents, normalizePackText } from './normalize.ts'

type JsonObject = Record<string, unknown>

// Work budgets also cap *enqueued* values, not only nodes already visited.
const MAX_GRAPH_WORK = 10_000
const MAX_TYPE_DECLARATIONS = 64
const MAX_OFFER_CANDIDATES = 10_000

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

// Treat Schema.org types as declared strings only; arbitrary coercion may throw
// and can turn nested arrays into counterfeit Product or Offer declarations.
function schemaTypes(value: unknown): string[] | null {
  const object = isObject(value) ? value : null
  if (!object) return []
  const raw = object['@type']
  if (raw == null) return []
  if (typeof raw === 'string') return raw.trim() ? [raw] : null
  if (Array.isArray(raw)) {
    if (raw.length > MAX_TYPE_DECLARATIONS) return null
    return raw.every((candidate) => typeof candidate === 'string' && candidate.trim())
      ? raw
      : null
  }
  return null
}

function hasType(value: unknown, type: string): boolean {
  const types = schemaTypes(value)
  return types?.some((candidate) => candidate.toLowerCase() === type.toLowerCase()) ?? false
}

// Iterative depth-first traversal avoids recursion overflow. The *active* set
// rejects actual cycles but permits ordinary shared acyclic subtrees.
function productNodes(value: unknown): JsonObject[] | null {
  const active = new WeakSet<object>()
  const stack: Array<{ value: unknown; leaving: boolean }> = [
    { value, leaving: false },
  ]
  const products: JsonObject[] = []
  let visited = 0

  while (stack.length > 0) {
    const frame = stack.pop()!
    const node = frame.value
    if (!Array.isArray(node) && !isObject(node)) continue
    if (frame.leaving) {
      active.delete(node)
      continue
    }
    // Bound direct-API input work even when a graph is acyclic.
    if (++visited > MAX_GRAPH_WORK || active.has(node)) return null
    active.add(node)
    stack.push({ value: node, leaving: true })

    if (Array.isArray(node)) {
      // Refuse pathological fanout before reading even the first array index.
      // Include queued siblings/leave frames to avoid wide nested queue growth.
      if (node.length > MAX_GRAPH_WORK || node.length + stack.length > MAX_GRAPH_WORK) return null
      for (let i = node.length - 1; i >= 0; i--) {
        stack.push({ value: node[i], leaving: false })
      }
      continue
    }

    const types = schemaTypes(node)
    if (types === null) return null
    if (types.some((candidate) => candidate.toLowerCase() === 'product')) {
      products.push(node)
    }
    if (Array.isArray(node['@graph'])) {
      stack.push({ value: node['@graph'], leaving: false })
    }
  }
  return products
}

function cents(value: unknown): number | null {
  const raw = asString(value)
  if (!raw) return null
  return normalizeMoneyToCents(raw)
}

function offerCandidates(raw: unknown): JsonObject[] | null {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  if (values.length > MAX_OFFER_CANDIDATES) return null
  const offers: JsonObject[] = []
  for (const value of values) {
    if (!isObject(value)) continue
    const types = schemaTypes(value)
    if (types === null) return null
    if (types.some((candidate) => {
      const type = candidate.toLowerCase()
      return type === 'offer' || type === 'aggregateoffer'
    })) offers.push(value)
  }
  return offers
}

function uniqueKnown<T>(values: T[]): T | null {
  const unique = [...new Set(values)]
  return unique.length === 1 ? unique[0] : null
}

// Bound the *total* nested work across all accepted offers, not merely each
// array or the outer offers count. Return null before reading any element of an
// oversized specification list. Callers catch hostile property/index getters.
function priceSpecificationCandidates(
  offer: JsonObject,
  budget: { remaining: number },
): JsonObject[] | null {
  const raw = offer.priceSpecification
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  if (values.length > budget.remaining) return null
  budget.remaining -= values.length

  const specifications: JsonObject[] = []
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (isObject(value)) specifications.push(value)
  }
  return specifications
}

function extractOfferMoney(offers: JsonObject[]): {
  price: number | null
  currency: string | null
} | null {
  const budget = { remaining: MAX_OFFER_CANDIDATES }
  const prices: number[] = []
  const currencies: string[] = []

  for (const offer of offers) {
    const specifications = priceSpecificationCandidates(offer, budget)
    if (specifications === null) return null

    const offerPrice = cents(offer.price ?? offer.lowPrice)
    if (offerPrice !== null) prices.push(offerPrice)
    const offerCurrency = asString(offer.priceCurrency)
    if (offerCurrency) currencies.push(offerCurrency.toUpperCase())

    for (const specification of specifications) {
      const specificationPrice = cents(specification.price ?? specification.lowPrice)
      if (specificationPrice !== null) prices.push(specificationPrice)
      const specificationCurrency = asString(specification.priceCurrency)
      if (specificationCurrency) currencies.push(specificationCurrency.toUpperCase())
    }
  }

  return {
    price: uniqueKnown(prices),
    currency: uniqueKnown(currencies),
  }
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
      reason: 'Product JSON-LD provenance is not a usable object',
    }
  }

  let products: JsonObject[] | null
  try {
    products = productNodes(jsonLd)
  } catch {
    products = null
  }
  if (products === null) {
    return { type: 'abstain', reason: 'Product JSON-LD graph or types are malformed' }
  }

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
  let name: string | null
  try {
    name = asString(product.name)
  } catch {
    return { type: 'abstain', reason: 'Product JSON-LD name metadata is malformed' }
  }
  if (!name) {
    return { type: 'abstain', reason: 'Product JSON-LD has no usable name' }
  }

  let offers: JsonObject[] | null
  try {
    offers = offerCandidates(product.offers)
  } catch {
    offers = null
  }
  if (offers === null) {
    return { type: 'abstain', reason: 'Product JSON-LD offer types are malformed' }
  }
  let money: ReturnType<typeof extractOfferMoney>
  try {
    money = extractOfferMoney(offers)
  } catch {
    money = null
  }
  if (money === null) {
    return { type: 'abstain', reason: 'Product JSON-LD price specifications are malformed' }
  }

  const { price, currency } = money
  if (currency !== null && currency !== 'EUR') {
    return {
      type: 'abstain',
      reason: `Product JSON-LD currency is not EUR: ${currency}`,
    }
  }

  if (price !== null && currency === null) {
    return {
      type: 'abstain',
      reason: 'Product JSON-LD priced offer has no explicit currency',
    }
  }

  // Reading the remaining caller-owned metadata can invoke accessors or
  // revoked Proxies even after the graph, offers and money checks succeed.
  // Keep those reads inside the same fail-closed parser boundary as validation.
  try {
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
