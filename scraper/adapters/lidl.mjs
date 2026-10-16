// Lidl: Nuxt 3 payload keyed `&erp<id>` with fullTitle, keyfacts
// (description = pack, analyticsCategory) and price. Most food articles are
// "in de winkel" only and have no online price: we record them with price
// null (honest unknown) instead of guessing.
import { decodeHtmlEntities, findAll, jsonLdProducts, nuxtData } from '../lib/extract.mjs'
import { walkSitemap } from '../lib/sitemap.mjs'
import { cleanText, makeRecord, normalizeAvailability, parsePack, toCents } from '../lib/normalize.mjs'

// keyfacts.description is free HTML: keep it only when it states a pack size.
function lidlPackText(description) {
  const text = cleanText(decodeHtmlEntities(description))
  if (!text) return null
  const firstItem = cleanText(decodeHtmlEntities(/<li>(.*?)<\/li>/i.exec(description ?? '')?.[1] ?? '')) ?? text
  if (parsePack(firstItem).amount !== null && firstItem.length <= 40) return firstItem
  return null
}

export function parseLidl(html, url) {
  const payload = nuxtData(html)
  const idFromUrl = /\/p(\d+)(?:[/?#]|$)/.exec(url)?.[1]
  const ld = jsonLdProducts(html)[0]
  const product = payload
    ? findAll(payload, (o) => typeof o.erpNumber === 'string' && o.keyfacts && (!idFromUrl || o.erpNumber === idFromUrl), 1)[0]
    : null
  if (!product && !ld) return []

  const price = product?.price ?? {}
  const current = toCents(price.price)
  const old = toCents(price.oldPrice)
  const ldOffer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers
  const promo = old && current && current < old
  return [
    makeRecord({
      retailer: 'lidl',
      sourceId: product?.erpNumber ?? ld?.sku ?? idFromUrl,
      url,
      name: product?.fullTitle ?? product?.keyfacts?.fullTitle ?? ld?.name,
      brand: product?.brand?.name ?? ld?.brand?.name ?? null,
      gtin: product?.gtin ?? ld?.gtin13 ?? null,
      category: product?.keyfacts?.analyticsCategory ?? null,
      packText: lidlPackText(product?.keyfacts?.description) ?? price.packaging?.text ?? null,
      imageUrl: Array.isArray(ld?.image) ? ld.image[0] : ld?.image ?? null,
      priceCents: promo ? old : current ?? toCents(ldOffer?.price),
      promoPriceCents: promo ? current : null,
      promoLabel: promo ? price.discount?.discountText ?? null : null,
      availability: normalizeAvailability(ldOffer?.availability),
    }),
  ]
}

export const lidl = {
  id: 'lidl',
  name: 'Lidl',
  host: 'www.lidl.nl',
  status: 'active',
  mode: 'http',
  notes: 'Nuxt 3 payload; many food items have no online price (in-store only)',
  async *discover({ fetcher }) {
    for await (const url of walkSitemap(fetcher, 'https://www.lidl.nl/static/sitemap.xml', {
      followIndex: (u) => /product_sitemap/.test(u),
    })) {
      yield { url, kind: 'product' }
    }
  },
  parse: parseLidl,
}
