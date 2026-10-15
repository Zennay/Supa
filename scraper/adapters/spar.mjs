// SPAR: JSON-LD Product (sku, gtin13, price, availability) on every product
// page; the pack size is the first `.c-offer__subtitle` (e.g. "70 Gram").
import { decodeHtmlEntities } from '../lib/extract.mjs'
import { walkSitemap } from '../lib/sitemap.mjs'
import { parseSchemaOrgPage } from './schemaorg.mjs'

export function parseSpar(html, url) {
  const subtitle = /class="c-offer__subtitle"[^>]*>([^<]+)</.exec(html)?.[1]
  const discontinued = /niet meer leverbaar/i.test(html)
  return parseSchemaOrgPage(html, url, {
    retailer: 'spar',
    packText: subtitle ? decodeHtmlEntities(subtitle.trim()) : null,
  }).map((r) =>
    discontinued && r.priceCents === null ? { ...r, availability: 'unavailable' } : r,
  )
}

export const spar = {
  id: 'spar',
  name: 'SPAR',
  host: 'www.spar.nl',
  status: 'active',
  mode: 'http',
  notes: 'JSON-LD Product with GTIN; product sitemap',
  async *discover({ fetcher }) {
    for await (const url of walkSitemap(fetcher, 'https://www.spar.nl/sitemap/products.xml')) {
      yield { url, kind: 'product' }
    }
  },
  parse: parseSpar,
}
