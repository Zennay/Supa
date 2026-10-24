import type { RawProductObservation } from '../../data/ingestion.ts'
import {
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
  type PlusRenderedCatalogEvidence,
  type PlusRenderedOffersEvidence,
} from '../../data/plusRenderedListings.ts'
import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
  type DekaMarktSsrCatalogEvidence,
  type DekaMarktSsrOffersEvidence,
} from '../../data/dekaMarktSsrListings.ts'
import { parsePlusRenderedProductEvidence, type PlusRenderedProductEvidence } from '../../data/plusRenderedProduct.ts'
import { parseDekaMarktSsrProductEvidence, type DekaMarktSsrProductEvidence } from '../../data/dekaMarktSsrProduct.ts'

/**
 * A product observed by the PLUS/DekaMarkt scrapers, ready for Producten.
 * Prices are the observed shelf prices at `capturedAt`, never "current".
 */
export type ScraperProduct = {
  id: string
  store: 'PLUS' | 'DekaMarkt'
  name: string
  priceCents: number | null
  originalPriceCents: number | null
  packLabel: string
  packAmount: number | null
  packUnit: string
  capturedAt: string
  imageUrl: string | null
  sourceUrl: string | null
}

export const SCRAPER_PRODUCTS_STORAGE_KEY = 'supa:scraper-products:v1'
const MAX_FILE_BYTES = 6 * 1024 * 1024
const MAX_PRODUCTS = 2000

/** Retailer image CDNs the scrapers are known to reference. */
const IMAGE_HOSTS = new Set([
  'images.ctfassets.net',
  'www.plus.nl',
  'www.dekamarkt.nl',
  'dekamarkt.nl',
  'cdn.dekamarkt.nl',
  'static.dekamarkt.nl',
])

export function safeRetailerImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if (!IMAGE_HOSTS.has(url.hostname)) return null
    return url.href
  } catch {
    return null
  }
}

const unitLabels: Record<string, string> = { g: 'gram', kg: 'kg', ml: 'ml', l: 'liter', piece: 'st', pack: 'pak' }

function packLabel(observation: RawProductObservation): string {
  const { amount, unit, rawText } = observation.pack
  if (typeof amount === 'number' && Number.isFinite(amount) && unit !== 'unknown') {
    return `${String(amount).replace('.', ',')} ${unitLabels[unit] ?? unit}`
  }
  return rawText?.trim() || ''
}

function absoluteSourceUrl(observation: RawProductObservation, href: string | null): string | null {
  const base = observation.provenance.supermarket === 'plus' ? 'https://www.plus.nl' : 'https://www.dekamarkt.nl'
  if (!href) return null
  try {
    const url = new URL(href, base)
    return url.protocol === 'https:' && (url.hostname === 'www.plus.nl' || url.hostname === 'www.dekamarkt.nl')
      ? url.href : null
  } catch {
    return null
  }
}

function toProduct(observation: RawProductObservation, imageUrl: string | null, href: string | null): ScraperProduct | null {
  if (observation.supermarket !== 'plus' && observation.supermarket !== 'dekamarkt') return null
  if (!observation.sourceProductId) return null
  const price = typeof observation.currentPriceCents === 'number' ? observation.currentPriceCents : null
  const store = observation.supermarket === 'plus' ? 'PLUS' : 'DekaMarkt'
  const original = observation.offer?.originalPriceCents ?? null
  return {
    id: `${observation.supermarket}:${observation.sourceProductId}`,
    store,
    name: observation.name,
    priceCents: price,
    originalPriceCents: typeof original === 'number' && price !== null && original > price ? original : null,
    packLabel: packLabel(observation),
    packAmount: observation.pack.amount,
    packUnit: observation.pack.unit,
    capturedAt: observation.provenance.capturedAt,
    imageUrl,
    sourceUrl: absoluteSourceUrl(observation, href),
  }
}

type JsonRecord = Record<string, unknown>
const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Optional image captured next to a rendered listing card. */
function cardImage(card: unknown): string | null {
  if (!isRecord(card)) return null
  return safeRetailerImageUrl(card.imageSrc ?? card.imageUrl ?? card.image)
}

/** First https image URL stored anywhere in a DekaMarkt Nuxt product record. */
function nuxtImage(payload: unknown, productId: string | null): string | null {
  if (!Array.isArray(payload) || !productId) return null
  for (const entry of payload) {
    if (!isRecord(entry) || !('productId' in entry)) continue
    const id = payload[entry.productId as number]
    if (String(id) !== productId) continue
    for (const key of ['image', 'imageUrl', 'thumbnail', 'mainImage']) {
      if (key in entry) {
        const ref = entry[key]
        const value = typeof ref === 'number' ? payload[ref] : ref
        const safe = safeRetailerImageUrl(value)
        if (safe) return safe
      }
    }
  }
  return null
}

/**
 * Convert one scraper evidence file (PLUS rendered catalog/offers/product or
 * DekaMarkt SSR catalog/offers/product) into Producten entries. The existing
 * strict retailer parsers decide which observations are trusted.
 */
export function productsFromScraperFile(text: string): ScraperProduct[] {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
    throw new Error('Bestand ontbreekt of is groter dan 6 MB.')
  }
  let root: unknown
  try { root = JSON.parse(text) } catch { throw new Error('Dit is geen geldig scraperbestand (JSON).') }
  if (!isRecord(root) || typeof root.evidenceType !== 'string') {
    throw new Error('Onbekend bestand: kies een PLUS- of DekaMarkt-scraperbestand.')
  }

  const fromListing = (
    result: { type: 'observations'; observations: RawProductObservation[] } | { type: 'abstain'; reason: string },
    cards: unknown[],
  ) => {
    if (result.type !== 'observations') throw new Error(`Bestand niet bruikbaar: ${result.reason}`)
    const byId = new Map<string, { image: string | null; href: string | null }>()
    for (const card of cards) {
      if (!isRecord(card) || typeof card.href !== 'string') continue
      const id = card.href.match(/-(\d+)\/?$/)?.[1] ?? card.href.match(/\/(\d+)\/?$/)?.[1]
      if (id) byId.set(id, { image: cardImage(card), href: card.href })
    }
    return result.observations.map(observation => {
      const extra = byId.get(observation.sourceProductId ?? '')
      return toProduct(observation, extra?.image ?? null, extra?.href ?? null)
    })
  }

  let products: (ScraperProduct | null)[]
  switch (root.evidenceType) {
    case 'plus-browser-rendered-catalog':
      products = fromListing(parsePlusRenderedCatalogEvidence(root as unknown as PlusRenderedCatalogEvidence),
        Array.isArray(root.cards) ? root.cards : [])
      break
    case 'plus-browser-rendered-offers':
      products = fromListing(parsePlusRenderedOffersEvidence(root as unknown as PlusRenderedOffersEvidence),
        Array.isArray(root.cards) ? root.cards : [])
      break
    case 'dekamarkt-public-ssr-nuxt-catalog':
    case 'dekamarkt-public-ssr-nuxt-offers': {
      const result = root.evidenceType === 'dekamarkt-public-ssr-nuxt-catalog'
        ? parseDekaMarktSsrCatalogEvidence(root as unknown as DekaMarktSsrCatalogEvidence)
        : parseDekaMarktSsrOffersEvidence(root as unknown as DekaMarktSsrOffersEvidence)
      if (result.type !== 'observations') throw new Error(`Bestand niet bruikbaar: ${result.reason}`)
      products = result.observations.map(observation =>
        toProduct(observation, nuxtImage(root.nuxtPayload, observation.sourceProductId), null))
      break
    }
    case 'plus-browser-rendered-schema-org-product': {
      const result = parsePlusRenderedProductEvidence(root as unknown as PlusRenderedProductEvidence)
      if (result.type !== 'observation') throw new Error(`Bestand niet bruikbaar: ${result.reason}`)
      const jsonLd = isRecord(root.jsonLd) ? root.jsonLd : {}
      products = [toProduct(result.observation, safeRetailerImageUrl(jsonLd.image),
        typeof jsonLd.url === 'string' ? jsonLd.url : null)]
      break
    }
    case 'dekamarkt-public-ssr-nuxt-product': {
      const result = parseDekaMarktSsrProductEvidence(root as unknown as DekaMarktSsrProductEvidence)
      if (result.type !== 'observation') throw new Error(`Bestand niet bruikbaar: ${result.reason}`)
      const jsonLd = isRecord(root.jsonLdProduct) ? root.jsonLdProduct : {}
      products = [toProduct(result.observation,
        safeRetailerImageUrl(jsonLd.image) ?? nuxtImage(root.nuxtPayload, result.observation.sourceProductId),
        isRecord(jsonLd.offers) && typeof jsonLd.offers.url === 'string' ? jsonLd.offers.url : null)]
      break
    }
    default:
      throw new Error('Onbekend scraperbestand: alleen PLUS en DekaMarkt worden ondersteund.')
  }
  const valid = products.filter((product): product is ScraperProduct => product !== null)
  if (!valid.length) throw new Error('Geen bruikbare producten in dit bestand.')
  return valid
}

/**
 * Combine observations per product: the newest known price wins, and an
 * image from any file (e.g. a product page) is kept for listing entries.
 */
export function mergeScraperProducts(current: ScraperProduct[], incoming: ScraperProduct[]): ScraperProduct[] {
  const byId = new Map(current.map(product => [product.id, product]))
  for (const product of incoming) {
    const existing = byId.get(product.id)
    if (!existing) { byId.set(product.id, product); continue }
    const newer = Date.parse(product.capturedAt) >= Date.parse(existing.capturedAt)
    const priced = (newer ? [product, existing] : [existing, product]).find(item => item.priceCents !== null)
    const base = newer ? product : existing
    byId.set(product.id, {
      ...base,
      priceCents: priced?.priceCents ?? null,
      originalPriceCents: priced?.originalPriceCents ?? null,
      capturedAt: priced?.capturedAt ?? base.capturedAt,
      imageUrl: base.imageUrl ?? (newer ? existing : product).imageUrl ?? null,
      sourceUrl: base.sourceUrl ?? (newer ? existing : product).sourceUrl ?? null,
    })
  }
  return [...byId.values()].slice(0, MAX_PRODUCTS)
}

export function readScraperProducts(storage: Pick<Storage, 'getItem'>): ScraperProduct[] {
  try {
    const raw = storage.getItem(SCRAPER_PRODUCTS_STORAGE_KEY)
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.products)) return []
    return value.products.filter((product): product is ScraperProduct =>
      isRecord(product) && typeof product.id === 'string' && typeof product.name === 'string' &&
      (product.store === 'PLUS' || product.store === 'DekaMarkt') &&
      (product.priceCents === null || Number.isSafeInteger(product.priceCents)) && typeof product.capturedAt === 'string',
    ).map(product => ({ ...product, imageUrl: safeRetailerImageUrl(product.imageUrl) }))
  } catch {
    return []
  }
}

export function writeScraperProducts(storage: Pick<Storage, 'setItem'>, products: ScraperProduct[]) {
  storage.setItem(SCRAPER_PRODUCTS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, products }))
}

/** Price per kg or liter in cents, when the pack makes that exact. */
export function unitPriceCents(product: ScraperProduct): { cents: number; unit: 'kg' | 'l' } | null {
  const amount = product.packAmount
  if (product.priceCents === null) return null
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  const factor = product.packUnit === 'g' ? 1000 / amount
    : product.packUnit === 'kg' ? 1 / amount
      : product.packUnit === 'ml' ? 1000 / amount
        : product.packUnit === 'l' ? 1 / amount : null
  if (factor === null) return null
  return { cents: Math.round(product.priceCents * factor), unit: product.packUnit === 'g' || product.packUnit === 'kg' ? 'kg' : 'l' }
}

/**
 * Photo of an imported scraper product whose name contains every word of
 * the ingredient (e.g. "bloemkool" -> "PLUS Bloemkool"). Only products that
 * actually carry a scraped image are considered.
 */
export function scraperImageForIngredient(products: ScraperProduct[], ingredient: string): string | null {
  const words = ingredient.toLocaleLowerCase('nl').split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2)
  if (!words.length) return null
  const match = products.find(product => {
    if (!product.imageUrl) return false
    const name = product.name.toLocaleLowerCase('nl')
    return words.every(word => name.includes(word))
  })
  return match?.imageUrl ?? null
}

/** Imported products from this browser; empty during SSR or without storage. */
export function storedScraperProducts(): ScraperProduct[] {
  if (typeof window === 'undefined') return []
  try { return readScraperProducts(window.localStorage) } catch { return [] }
}
