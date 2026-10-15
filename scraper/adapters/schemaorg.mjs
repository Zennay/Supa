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

export function schemaOrgPrices(offers) {
  const list = (Array.isArray(offers) ? offers : [offers]).filter(Boolean)
  const prices = []
  let regular = null
  let validity = {}
  for (const offer of list) {
    const direct = toCents(pick(offer, ['price', 'lowPrice']))
    if (direct !== null) prices.push(direct)
    const specs = [pick(offer, ['priceSpecification'])].flat().filter(Boolean)
    for (const spec of specs) {
      const cents = toCents(pick(spec, ['price']))
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
