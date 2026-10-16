// PLUS: OutSystems single-page app. The raw HTML is an empty shell, so the
// page is rendered in headless Chromium (Playwright) and we read the JSON-LD
// Product it injects (sku, Gtin13, weight, offers.priceSpecification).
// The browser renderer still goes through the polite fetcher's robots check
// and per-host pacing; images/fonts/media are not downloaded.
import { walkSitemap } from '../lib/sitemap.mjs'
import { parseSchemaOrgPage } from './schemaorg.mjs'

export function parsePlus(html, url) {
  let source
  try { source = new URL(url) } catch { return [] }
  // The observed article route, not arbitrary JSON-LD, establishes SKU.
  if (source.protocol !== 'https:' || source.hostname !== plus.host ||
      source.username || source.password || source.port) return []
  const sku = /-(\d+)\/?$/.exec(source.pathname)?.[1]
  if (!sku) return []
  const articlePath = source.pathname.replace(/\/$/, '')
  return parseSchemaOrgPage(html, url, { retailer: 'plus' }).filter((record) => {
    if (record.sourceId !== sku || !record.url) return false
    try {
      const declared = new URL(record.url)
      return declared.protocol === 'https:' && declared.hostname === source.hostname &&
        declared.port === source.port && !declared.username && !declared.password &&
        declared.pathname.replace(/\/$/, '') === articlePath
    } catch { return false }
  })
}

export const plus = {
  id: 'plus',
  name: 'PLUS',
  host: 'www.plus.nl',
  status: 'active',
  mode: 'browser',
  // A few tabs in parallel (navigation starts are still paced per host).
  concurrency: 3,
  notes: 'OutSystems SPA: headless render, then JSON-LD Product with GTIN',
  async *discover({ fetcher }) {
    for await (const url of walkSitemap(
      fetcher,
      'https://www.plus.nl/ECP_Sitemap_Engine/rest/Sitemap/product',
    )) {
      yield { url, kind: 'product' }
    }
  },
  parse: parsePlus,
  // Rendered page is "ready" once the Product JSON-LD is present.
  readySelector: 'script[type="application/ld+json"]',
  readyCheck: (html) => /"@type"\s*:\s*"Product"/.test(html),
}
