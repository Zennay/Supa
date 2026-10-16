// Generic schema.org Product (JSON-LD) mapping, shared by retailers that
// publish JSON-LD on their product pages.
import { jsonLdProducts } from '../lib/extract.mjs'
import { makeRecord, normalizeAvailability, toCents } from '../lib/normalize.mjs'

function first(value) {
  return Array.isArray(value) ? value[0] : value
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const key of keys) {
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === key.toLowerCase() && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
        return obj[k]
      }
    }
  }
  return undefined
}

// Missing currency is retained for legacy source formats, but any explicit
// currency other than EUR is not an amount of euro cents. Currency at the
// nested specification level overrides the parent Offer currency.
function isEuroPrice(source, inheritedCurrency) {
  const specified = pick(source, ['priceCurrency']) ?? inheritedCurrency
  return specified === undefined || specified === null ||
    (typeof specified === 'string' && specified.trim().toUpperCase() === 'EUR')
}

// JSON-LD object keys can differ only by case while asserting contradictory
// monetary evidence. A first-match, case-insensitive pick() would otherwise
// silently use whichever spelling is encountered first. Require agreement
// among ALL explicitly present spellings before admitting any price.
function conflictingCaseEvidence(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false
  const keys = Object.keys(source)
  for (const field of ['price', 'lowprice', 'pricecurrency']) {
    const variants = keys.filter(key => key.toLowerCase() === field)
    if (variants.length < 2) continue
    const normalized = variants.map(key => {
      const value = source[key]
      if (field === 'pricecurrency') {
        return typeof value === 'string' && value.trim()
          ? value.trim().toUpperCase() : null
      }
      return toCents(value)
    })
    if (normalized.some(value => value === null || value !== normalized[0])) {
      return true
    }
  }
  return false
}

export function schemaOrgPrices(offers) {
  const list = (Array.isArray(offers) ? offers : [offers]).filter(Boolean)
  // Currency and price variants must agree in every direct Offer and nested
  // priceSpecification. Do not select the cheapest of conflicting assertions.
  if (list.some(offer =>
    conflictingCaseEvidence(offer) ||
    [pick(offer, ['priceSpecification'])].flat().filter(Boolean).some(conflictingCaseEvidence))) {
    return { priceCents: null, promoPriceCents: null }
  }
  const prices = []
  let regular = null
  let validity = {}
  for (const offer of list) {
    const currency = pick(offer, ['priceCurrency'])
    const direct = isEuroPrice(offer) ? toCents(pick(offer, ['price', 'lowPrice'])) : null
    if (direct !== null) prices.push(direct)
    const specs = [pick(offer, ['priceSpecification'])].flat().filter(Boolean)
    for (const spec of specs) {
      const cents = isEuroPrice(spec, currency) ? toCents(pick(spec, ['price'])) : null
      if (cents === null) continue
      if (/strikethrough|listprice|srp/i.test(String(spec.priceType ?? ''))) regular = cents
      else {
        prices.push(cents)
        if (spec.validFrom || spec.validThrough) {
          validity = { validFrom: spec.validFrom ?? null, validThrough: spec.validThrough ?? null }
        }
      }
    }
  }
  if (!prices.length) return { priceCents: regular, promoPriceCents: null }
  const current = Math.min(...prices)
  if (regular !== null && current < regular) {
    return { priceCents: regular, promoPriceCents: current, ...validity }
  }
  return { priceCents: current, promoPriceCents: null }
}

export function recordFromSchemaOrg(ld, { retailer, url, sourceId, packText, ...extra }) {
  const offers = pick(ld, ['offers'])
  const offer = first(offers)
  const brand = pick(ld, ['brand'])
  const weight = pick(ld, ['weight', 'size'])
  const { priceCents, promoPriceCents, validFrom, validThrough } = schemaOrgPrices(offers)
  return makeRecord({
    retailer,
    sourceId: sourceId ?? pick(ld, ['sku', 'productID', 'mpn']) ?? pick(offer, ['sku']),
    url: pick(ld, ['url']) ?? url,
    name: pick(ld, ['name']),
    brand: typeof brand === 'object' ? pick(brand, ['name']) : brand,
    gtin: pick(ld, ['gtin13', 'gtin', 'gtin14', 'gtin12', 'gtin8', 'ean']),
    category: typeof pick(ld, ['category']) === 'string' ? pick(ld, ['category']) : null,
    packText:
      packText ?? (typeof weight === 'object' ? pick(weight, ['value']) : weight) ?? null,
    imageUrl: (() => {
      const img = first(pick(ld, ['image']))
      return typeof img === 'object' ? pick(img, ['url']) : img ?? null
    })(),
    priceCents,
    promoPriceCents,
    promoLabel: promoPriceCents ? pick(offer, ['description']) ?? null : null,
    promoValidFrom: promoPriceCents ? validFrom ?? null : null,
    promoValidUntil: promoPriceCents ? validThrough ?? pick(offer, ['priceValidUntil']) ?? null : null,
    availability: normalizeAvailability(pick(offer, ['availability'])),
    ...extra,
  })
}

export function parseSchemaOrgPage(html, url, options) {
  return jsonLdProducts(html)
    .map((ld) => recordFromSchemaOrg(ld, { url, ...options }))
    .filter((r) => r.sourceId && r.sourceId !== 'undefined' && r.name)
}
