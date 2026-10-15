// Dirk van den Broek and DekaMarkt run on the same Detailresult Nuxt 3
// platform. Product pages embed `data["product-<id>"]` (Dirk) or
// `data["product-information-<id>"]` (DekaMarkt) in the __NUXT_DATA__ payload:
//   headerText, brand, packaging, department, webgroup,
//   productAssortment { normalPrice, offerPrice, productOffer, ... }
// JSON-LD (offers.Price) is used as a fallback.
import { findAll, jsonLdProducts, nuxtData } from '../lib/extract.mjs'
import { walkSitemap } from '../lib/sitemap.mjs'
import { makeRecord, normalizeAvailability, toCents } from '../lib/normalize.mjs'

function offerLabel(offer) {
  if (!offer || typeof offer !== 'object') return null
  const raw =
    offer.textPriceSign ?? offer.offerText ?? offer.title ?? offer.headerText ?? offer.description
  if (typeof raw !== 'string') return null
  const label = raw.replace(/[_\s]+/g, ' ').trim()
  return label ? label.charAt(0).toUpperCase() + label.slice(1).toLowerCase() : null
}

export function parseDetailresultProduct(html, url, { retailer, fileBase }) {
  const payload = nuxtData(html)
  const candidates = payload?.data
    ? findAll(
        payload.data,
        (o) => typeof o.productId === 'number' && o.productAssortment && typeof o.productAssortment === 'object',
      )
    : []
  const idFromUrl = /\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1]
  const info =
    candidates.find((c) => String(c.productId) === idFromUrl) ?? candidates[0]

  if (info) {
    const a = info.productAssortment
    const pi = a.productInformation ?? {}
    const normal = toCents(a.normalPrice)
    const offer = toCents(a.offerPrice)
    const promo = offer && normal && offer > 0 && offer < normal ? offer : null
    const image = info.images?.find((i) => i.mainImage)?.image ?? pi.image ?? null
    return [
      makeRecord({
        retailer,
        sourceId: info.productId,
        url,
        name: info.headerText ?? pi.headerText,
        brand: info.brand ?? pi.brand,
        category: [info.department ?? pi.department, info.webgroup ?? pi.webgroup]
          .filter(Boolean)
          .join(' > '),
        packText: info.packaging ?? pi.packaging,
        imageUrl: image ? new URL(image, fileBase).href : null,
        priceCents: normal || null,
        promoPriceCents: promo,
        promoLabel: promo ? offerLabel(a.productOffer) : null,
        promoValidFrom: promo ? a.productOffer?.startDate ?? null : null,
        promoValidUntil: promo ? a.productOffer?.endDate ?? null : null,
        availability: normal ? 'available' : 'unknown',
      }),
    ]
  }

  const ld = jsonLdProducts(html)[0]
  if (!ld) return []
  const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers
  return [
    makeRecord({
      retailer,
      sourceId: ld.mpn ?? idFromUrl,
      url,
      name: ld.name,
      brand: ld.brand?.name ?? ld.brand,
      priceCents: toCents(offers?.Price ?? offers?.price),
      availability: normalizeAvailability(offers?.availability),
    }),
  ]
}

export function createDetailresultAdapter({ id, name, host, fileBase, sitemap, rewriteUrl = (u) => u }) {
  return {
    id,
    name,
    host,
    status: 'active',
    mode: 'http',
    notes: 'Nuxt 3 payload (Detailresult platform), product sitemap',
    async *discover({ fetcher }) {
      for await (const loc of walkSitemap(fetcher, sitemap, {
        followIndex: (u) => /products-sitemap/.test(u),
        accept: (u) => /\/\d+\/?$/.test(u),
      })) {
        yield { url: rewriteUrl(loc), kind: 'product' }
      }
    },
    parse(html, url) {
      return parseDetailresultProduct(html, url, { retailer: id, fileBase })
    },
  }
}

export const dirk = createDetailresultAdapter({
  id: 'dirk',
  name: 'Dirk van den Broek',
  host: 'www.dirk.nl',
  fileBase: 'https://web-fileserver.dirk.nl/',
  sitemap: 'https://www.dirk.nl/sitemap.xml',
})

export const dekamarkt = createDetailresultAdapter({
  id: 'dekamarkt',
  name: 'DekaMarkt',
  host: 'www.dekamarkt.nl',
  fileBase: 'https://web-fileserver.dekamarkt.nl/',
  sitemap: 'https://www.dekamarkt.nl/sitemap.xml',
  // The sitemap lists /boodschappen/producten/... but pages live at /producten/...
  rewriteUrl: (u) => u.replace('://www.dekamarkt.nl/boodschappen/producten/', '://www.dekamarkt.nl/producten/'),
})
