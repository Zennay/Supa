// Poiesz: webshop on webwinkel.poiesz-supermarkten.nl (Nuxt 3). The
// category tree (main > sub > subsub) is embedded in every page; subsub
// listing pages carry complete product objects (id, name, brandName, price,
// strikeThroughPrice, promotion, promotionLabel, ean, volumeCe, unitId) with
// paging { page, pages }. No product sitemap exists, so we walk the tree.
import { findAll, nuxtData } from '../lib/extract.mjs'
import { makeRecord, packFromAmount, toCents } from '../lib/normalize.mjs'

const BASE = 'https://webwinkel.poiesz-supermarkten.nl'

export function poieszProductToRecord(p, { url } = {}) {
  const pack = packFromAmount(p.volumeCe ?? p.volumeCE ?? p.weightCe ?? p.weightCE, p.unitId ?? p.unitID)
  const price = toCents(p.price)
  const strike = toCents(p.strikeThroughPrice)
  const promo = strike && price && price < strike
  return makeRecord({
    retailer: 'poiesz',
    sourceId: p.id,
    url: url ?? `${BASE}/boodschappen/producten/${p.id}`,
    name: p.name ?? p.commercialText,
    brand: p.brandName,
    gtin: p.ean,
    packText: p.packageDescription ?? p.description ?? null,
    pack: pack.amount !== null ? pack : undefined,
    imageUrl: p.image ?? null,
    priceCents: promo ? strike : price,
    promoPriceCents: promo ? price : null,
    promoLabel: p.promotion ? p.promotionLabel ?? null : null,
    availability: price ? 'available' : 'unknown',
  })
}

const isProduct = (o) =>
  (typeof o.id === 'number' || typeof o.id === 'string') &&
  'price' in o &&
  'ean' in o &&
  typeof (o.name ?? o.commercialText) === 'string'

export function parsePoiesz(html, url) {
  const payload = nuxtData(html)
  if (!payload) return []
  const productPage = /\/boodschappen\/producten\/(\d+)/.exec(url)?.[1]
  const seen = new Map()
  for (const p of findAll(payload.data ?? payload, isProduct)) {
    if (productPage && String(p.id) !== productPage) continue
    if (!seen.has(String(p.id))) seen.set(String(p.id), poieszProductToRecord(p))
  }
  // Product detail pages have the listing fields at data["product-<id>"].
  if (productPage && !seen.size) {
    const detail = payload.data?.[`product-${productPage}`]
    if (detail && isProduct(detail)) seen.set(productPage, poieszProductToRecord(detail, { url }))
  }
  return [...seen.values()]
}

export function poieszCategoryUrls(html) {
  const payload = nuxtData(html)
  const tree = payload?.data
    ? Object.entries(payload.data).find(([k]) => /main-categories$/.test(k))?.[1]
    : null
  const urls = []
  for (const main of tree ?? []) {
    for (const sub of main.subCategories ?? []) {
      const subsubs = sub.subSubCategories ?? []
      if (!subsubs.length) urls.push(`${BASE}/boodschappen/${main.url}/${sub.url}`)
      for (const ss of subsubs) urls.push(`${BASE}/boodschappen/${main.url}/${sub.url}/${ss.url}`)
    }
  }
  return urls
}

export function poieszPaging(html) {
  const payload = nuxtData(html)
  return payload?.data ? findAll(payload.data, (o) => o.paging && typeof o.paging.pages === 'number', 1)[0]?.paging ?? null : null
}

export const poiesz = {
  id: 'poiesz',
  name: 'Poiesz',
  host: 'webwinkel.poiesz-supermarkten.nl',
  status: 'active',
  mode: 'http',
  notes: 'Nuxt 3 listing pages (category tree crawl, paged)',
  async *discover({ fetcher }) {
    const home = await fetcher.getText(`${BASE}/boodschappen`)
    for (const url of poieszCategoryUrls(home)) {
      yield { url, kind: 'listing' }
    }
  },
  async *expand(html, item) {
    // Follow pagination of a listing page.
    if (item.page) return
    const paging = poieszPaging(html)
    for (let page = 2; paging && page <= paging.pages; page += 1) {
      yield { url: `${item.url}?page=${page}`, kind: 'listing', page }
    }
  },
  parse: parsePoiesz,
}
