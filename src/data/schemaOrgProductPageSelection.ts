import type { SourceSnapshotRef } from './ingestion.ts'
import { structuredSchemaOrgPack } from './schemaOrgQuantitativePack.ts'
import {
  parseSchemaOrgProduct,
  type SchemaOrgParseResult,
} from './schemaOrgProduct.ts'

/**
 * A conservative offline selector for an authorized, already-captured product
 * page which embeds a Schema.org graph with several Product nodes.
 *
 * This module never downloads a page, guesses a product by label/price, or
 * authorizes retailer ingestion. A multi-Product page must establish ONE exact
 * product URL matching its recorded source URL, and ALL other product nodes
 * must declare distinct URLs. Otherwise we refuse instead of selecting an
 * arbitrary recommendation from the page.
 */
function refuses(reason: string): SchemaOrgParseResult {
  return { type: 'abstain', reason }
}

type DataObject = Record<string, unknown>

function readData(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) throw new Error('accessor in JSON-LD')
  return descriptor.value
}

function isProductType(raw: unknown): boolean {
  const values = Array.isArray(raw) ? raw : [raw]
  return values.some(
    (value) => typeof value === 'string' && value.toLowerCase() === 'product',
  )
}

function productNodes(jsonLd: unknown): DataObject[] {
  const seen = new WeakSet<object>()
  const result: DataObject[] = []
  let visited = 0
  function inspect(value: unknown, depth: number) {
    if (value === null || typeof value !== 'object') return
    if (++visited > 256 || depth > 8 || seen.has(value)) {
      throw new Error('ambiguous or excessive JSON-LD graph')
    }
    seen.add(value)
    if (Array.isArray(value)) {
      if (value.length > 128) throw new Error('JSON-LD array too long')
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new Error('sparse JSON-LD array')
        }
        inspect(readData(value, String(index)), depth + 1)
      }
      return
    }
    const record = value as DataObject
    if (isProductType(readData(record, '@type'))) {
      result.push(record)
      if (result.length > 32) throw new Error('too many Product nodes')
    }
    // WebPage.mainEntity and ItemList.itemListElement[].item are standard
    // Schema.org Product placements, not invented selectors. Inspect their
    // actual nested objects while retaining the same bounded all-Product
    // ambiguity policy as a top-level @graph.
    for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) {
      const child = readData(record, key)
      if (child === undefined) continue
      if (key === '@graph' && !Array.isArray(child)) {
        throw new Error('invalid @graph')
      }
      inspect(child, depth + 1)
    }
  }
  inspect(jsonLd, 0)
  return result
}

function normalizedHttpsUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048 || !input.trim()) {
    return null
  }
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.hash || url.href !== input) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

function readSelectedProduct(product: DataObject, source: SourceSnapshotRef): SchemaOrgParseResult {
  const pack = structuredSchemaOrgPack(product)
  if (pack.status === 'unsafe') {
    return refuses('selected Product has ambiguous physical packaging')
  }
  // Snapshot own descriptors without invoking accessor properties or mutating
  // the captured JSON-LD. Never re-enter unrelated nested @graph Product nodes
  // after a single provenance-bound product has already been selected.
  const keys = Reflect.ownKeys(product)
  if (keys.length > 64) return refuses('selected Product has excessive fields')
  const selected: DataObject = Object.create(null)
  for (const key of keys) {
    if (typeof key !== 'string') return refuses('selected Product has unsafe fields')
    if (key === '@graph') continue
    const descriptor = Object.getOwnPropertyDescriptor(product, key)
    if (!descriptor || !('value' in descriptor)) {
      return refuses('selected Product has unsafe fields')
    }
    Object.defineProperty(selected, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  if (pack.status === 'normalized') {
    selected.weight = { value: pack.weightText }
  }
  const result = parseSchemaOrgProduct(selected, source)
  // Legacy parser diagnostics can include a raw attacker-controlled currency.
  // This offline operator boundary must not echo untrusted product metadata.
  return result.type === 'observation' ? result :
    refuses('selected Product price, currency or provenance not verified')
}

function trustedRetailerProductSource(source: SourceSnapshotRef): string | null {
  if (source?.kind !== 'product') return null
  const href = normalizedHttpsUrl(source.url)
  if (!href) return null
  const hosts: Record<string, { host: string; route: string }> = {
    plus: { host: 'www.plus.nl', route: '/product/' },
    dekamarkt: { host: 'www.dekamarkt.nl', route: '/producten/' },
    ah: { host: 'www.ah.nl', route: '/producten/product/' },
  }
  const expected = hosts[source.supermarket]
  if (!expected) return null
  const parsed = new URL(href)
  // This price parser is also called directly on historical private HTML.
  // It must not promote a URL the one-page M1 capture and offline selector
  // readers refuse. Mirror isAllowedM1RetailerSourcePath's product path:
  // no duplicate slash, encoded separator/dot/double-encoding or controls.
  const path = parsed.pathname
  const ambiguous = /%(?:2f|5c|2e|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path) ||
    path.includes('\\')
  return parsed.hostname === expected.host && parsed.port === '' &&
    !parsed.search && !parsed.hash && !ambiguous &&
    path.startsWith(expected.route) && path.length > expected.route.length &&
    path[expected.route.length] !== '/' ? href : null
}

/**
 * Selection is deliberately tied to a source-verified page URL, not a fuzzy
 * text match. The existing Schema.org parser remains the ONLY price, stock,
 * currency, pack and source-provenance authority after selection.
 *
 * Missing/mismatched/duplicated URLs never silently fall back to the first
 * node. Even a single Product with an explicitly contradictory URL abstains.
 */
export function parseSchemaOrgProductForPage(
  jsonLd: unknown,
  provenance: SourceSnapshotRef,
): SchemaOrgParseResult {
  try {
    const products = productNodes(jsonLd)
    if (products.length === 0) return refuses('no Product JSON-LD node')

    const sourceUrl = trustedRetailerProductSource(provenance)
    if (!sourceUrl) return refuses('invalid captured product-page URL')

    if (products.length === 1) {
      const declared = readData(products[0], 'url')
      if (declared !== undefined &&
          normalizedHttpsUrl(declared) !== sourceUrl) {
        return refuses('Product URL disagrees with captured page')
      }
      return readSelectedProduct(products[0], provenance)
    }

    const urls = products.map((product) =>
      normalizedHttpsUrl(readData(product, 'url')))
    if (urls.some((url) => url === null) ||
        new Set(urls).size !== products.length) {
      return refuses('multiple Product nodes lack distinct trusted URLs')
    }
    const matching = products.filter((_, index) => urls[index] === sourceUrl)
    if (matching.length !== 1) {
      return refuses('no unambiguous Product URL matches captured page')
    }
    return readSelectedProduct(matching[0], provenance)
  } catch {
    // Includes revoked Proxy/hostile getter/cyclic or oversized graph inputs;
    // never echo retailer/customer-controlled content into an operator error.
    return refuses('unsafe or malformed Product JSON-LD graph')
  }
}
