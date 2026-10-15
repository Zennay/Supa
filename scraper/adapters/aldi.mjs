// ALDI: Next.js page; pageProps.apiData is a JSON string containing
// ["PRODUCT_DETAIL_GET", { res: { products: [...] } }] with name, brandName,
// salesUnit, currentPrice { priceValue, priceTagLabels }, isAvailable.
import { nextData } from '../lib/extract.mjs'
import { walkSitemap } from '../lib/sitemap.mjs'
import { makeRecord, toCents } from '../lib/normalize.mjs'

function productsFromApiData(apiData) {
  let parsed = apiData
  if (typeof apiData === 'string') {
    try {
      parsed = JSON.parse(apiData)
    } catch {
      return []
    }
  }
  const out = []
  const visit = (node) => {
    if (!Array.isArray(node)) return
    if (node[0] === 'PRODUCT_DETAIL_GET' && node[1]?.res?.products) out.push(...node[1].res.products)
    else node.forEach(visit)
  }
  visit(parsed)
  return out
}

const dateFromEpoch = (s) =>
  Number.isFinite(s) ? new Date(s * 1000).toISOString() : null

export function parseAldi(html, url) {
  const next = nextData(html)
  const products = productsFromApiData(next?.props?.pageProps?.apiData)
  const idFromUrl = /-(\d+)\.html/.exec(url)?.[1]
  return products
    .filter((p) => !idFromUrl || String(p.objectID) === idFromUrl)
    .map((p) => {
      const price = p.currentPrice ?? {}
      const labels = Object.values(price.priceTagLabels ?? {}).filter(Boolean)
      const hasOldPrice = toCents(price.strikePriceValue ?? price.oldPriceValue)
      const current = toCents(price.priceValue)
      return makeRecord({
        retailer: 'aldi',
        sourceId: p.objectID,
        url,
        name: p.name,
        brand: p.brandName,
        category: p.mainCategoryID ?? null,
        packText: p.salesUnit ?? p.shortDescription,
        imageUrl: p.assets?.find((a) => a.type === 'primary')?.url ?? null,
        priceCents: hasOldPrice && current && current < hasOldPrice ? hasOldPrice : current,
        promoPriceCents: hasOldPrice && current && current < hasOldPrice ? current : null,
        promoLabel: labels.join(' ') || null,
        promoValidFrom: labels.length ? dateFromEpoch(price.validFrom) : null,
        promoValidUntil: labels.length ? dateFromEpoch(price.validUntil) : null,
        availability: p.isAvailable === true ? 'available' : p.isAvailable === false ? 'unavailable' : 'unknown',
      })
    })
}

export const aldi = {
  id: 'aldi',
  name: 'ALDI',
  host: 'www.aldi.nl',
  status: 'active',
  mode: 'http',
  notes: 'Next.js apiData PRODUCT_DETAIL_GET; product sitemap',
  async *discover({ fetcher }) {
    for await (const url of walkSitemap(fetcher, 'https://www.aldi.nl/sitemaps/.aldi-nord-sitemap-products.xml')) {
      yield { url, kind: 'product' }
    }
  },
  parse: parseAldi,
}
