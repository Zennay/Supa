// Dirk van den Broek and DekaMarkt run on the same Detailresult Nuxt 3
// platform. Product pages embed `data["product-<id>"]` (Dirk) or
// `data["product-information-<id>"]` (DekaMarkt) in the __NUXT_DATA__ payload:
//   headerText, brand, packaging, department, webgroup,
//   productAssortment { normalPrice, offerPrice, productOffer, ... }
// JSON-LD (offers.Price) is used as a fallback.
import { findAll, jsonLdProducts, nuxtData } from '../lib/extract.mjs'
import { walkSitemap } from '../lib/sitemap.mjs'
import { makeRecord, normalizeAvailability, toCents } from '../lib/normalize.mjs'
import { schemaOrgPrices } from './schemaorg.mjs'

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
  // A Nuxt candidate belongs to this page only when its actual numeric
  // article identity matches the canonical product route. Never silently
  // borrow the first unrelated product/price from an embedded payload.
  if (candidates.length && !idFromUrl) return []
  const info = candidates.find((c) => String(c.productId) === idFromUrl)
  if (candidates.length && !info) return []

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

  // Nuxt can be absent on a rendered detail page. Its JSON-LD fallback
  // must still bind this exact source article: a first unrelated Product or
  // an unlabelled Product is not evidence for a private price.
  const products = jsonLdProducts(html)
  if (products.length !== 1 || !idFromUrl) return []
  const ld = products[0]
  let source
  try { source = new URL(url) } catch { return [] }
  const expectedHost = retailer === 'dirk' ? 'www.dirk.nl' :
    retailer === 'dekamarkt' ? 'www.dekamarkt.nl' : null
  if (!expectedHost || source.protocol !== 'https:' ||
      source.hostname !== expectedHost || source.port ||
      source.username || source.password || source.search || source.hash) return []
  const hasMpn = Object.hasOwn(ld, 'mpn')
  const hasArticleUrl = Object.hasOwn(ld, 'url')
  if (!hasMpn && !hasArticleUrl) return []
  if (hasMpn && String(ld.mpn) !== idFromUrl) return []
  if (hasArticleUrl) {
    let declared
    try { declared = new URL(ld.url) } catch { return [] }
    if (declared.protocol !== source.protocol ||
        declared.hostname !== source.hostname ||
        declared.port !== source.port || declared.username ||
        declared.password || declared.search || declared.hash ||
        declared.pathname.replace(/\\/$/, '') !==
          source.pathname.replace(/\\/$/, '')) return []
  }
  const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers
  // The Nuxt-first fallback must not bypass the same EUR-only contract as
  // the shared Schema.org price parser used by PLUS.
  const { priceCents } = schemaOrgPrices(offers)
  return [
    makeRecord({
      retailer,
      // Canonical source route is the identity, never a JSON-LD guess.
      sourceId: idFromUrl,
      url,
      name: ld.name,
      brand: ld.brand?.name ?? ld.brand,
      priceCents,
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
