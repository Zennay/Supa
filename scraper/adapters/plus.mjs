// PLUS: OutSystems single-page app. The raw HTML is an empty shell, so the
// page is rendered in headless Chromium (Playwright) and we read the JSON-LD
// Product it injects (sku, Gtin13, weight, offers.priceSpecification).
// The browser renderer still goes through the polite fetcher's robots check
// and per-host pacing; images/fonts/media are not downloaded.
import { walkSitemap } from '../lib/sitemap.mjs'
import { parseSchemaOrgPage } from './schemaorg.mjs'

export function parsePlus(html, url) {
  const sku = /-(\d+)\/?$/.exec(new URL(url).pathname)?.[1]
  return parseSchemaOrgPage(html, url, { retailer: 'plus' }).filter(
    (r) => !sku || r.sourceId === sku,
  )
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
