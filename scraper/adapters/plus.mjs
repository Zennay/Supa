// PLUS: OutSystems single-page app. The HTML is an empty shell; the page's
// own frontend loads product data from two anonymous JSON "screen service"
// actions. We call those directly (≈200 ms, no browser):
//   DataActionGetProductDetailsAndAgeInfo -> name, brand, price, EAN, size
//   DataActionGetPromotionOffer           -> promo price, label, validity
// OutSystems versions every action; the tokens are read from the public
// module manifest + the PDPContent JS module, and refreshed when the server
// reports a version change. parse() still understands browser-rendered
// JSON-LD pages as a fallback.
import { walkSitemap } from '../lib/sitemap.mjs'
import { makeRecord, packFromAmount, toCents } from '../lib/normalize.mjs'
import { parseSchemaOrgPage } from './schemaorg.mjs'

const BASE = 'https://www.plus.nl'
const SERVICE = 'screenservices/ECP_Product_CW/ProductDetails/PDPContent'
const DETAILS = 'DataActionGetProductDetailsAndAgeInfo'
const PROMO = 'DataActionGetPromotionOffer'
// OutSystems' fixed CSRF token for anonymous sessions (also sent by the site).
const ANONYMOUS_CSRF = 'T6C+9iB49TLra4jEsMeSckDMNhQ='

const skuFromUrl = (url) => /-(\d+)\/?$/.exec(new URL(url).pathname)?.[1] ?? null

export function parsePlusApiVersions(js) {
  const versions = {}
  for (const m of js.matchAll(/callDataAction\("(\w+)",\s*"([^"]+)",\s*"([^"]+)"/g)) versions[m[1]] = m[3]
  return versions
}

let versionsPromise = null

async function loadVersions(fetcher) {
  const info = JSON.parse(await fetcher.getText(`${BASE}/moduleservices/moduleinfo`, { accept: 'application/json' }))
  const moduleVersion = info.manifest.versionToken
  const scriptKey = Object.keys(info.manifest.urlVersions).find((k) => k.endsWith('/ECP_Product_CW.ProductDetails.PDPContent.mvc.js'))
  if (!scriptKey) throw new Error('PLUS module manifest has no PDPContent script')
  const js = await fetcher.getText(`${BASE}${scriptKey}${info.manifest.urlVersions[scriptKey]}`, { accept: '*/*' })
  const apiVersions = parsePlusApiVersions(js)
  if (!apiVersions[DETAILS] || !apiVersions[PROMO]) throw new Error('PLUS action versions not found')
  return { moduleVersion, apiVersions }
}

async function callAction(fetcher, versions, action, sku) {
  const res = await fetcher.request(`${BASE}/${SERVICE}/${action}`, {
    method: 'POST',
    accept: 'application/json',
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-csrftoken': ANONYMOUS_CSRF,
      'outsystems-locale': 'nl-NL',
    },
    body: JSON.stringify({
      versionInfo: { moduleVersion: versions.moduleVersion, apiVersion: versions.apiVersions[action] },
      viewName: 'MainFlow.ProductDetailsPage',
      screenData: { variables: { SKU: sku, ProductName: '', Locale: 'nl-NL', StoreId: '0', ChannelId: '' } },
    }),
  })
  const json = JSON.parse(res.text)
  if (json.exception) throw new Error(`PLUS ${action}: ${json.exception.message ?? 'exception'}`)
  return json
}

export async function fetchPlusProduct(url, { fetcher }) {
  const sku = skuFromUrl(url)
  if (!sku) throw new Error(`no SKU in ${url}`)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    versionsPromise ??= loadVersions(fetcher).catch((error) => {
      versionsPromise = null
      throw error
    })
    const versions = await versionsPromise
    const details = await callAction(fetcher, versions, DETAILS, sku)
    const promo = await callAction(fetcher, versions, PROMO, sku)
    const changed = [details, promo].some(
      (r) => r.versionInfo?.hasModuleVersionChanged || r.versionInfo?.hasApiVersionChanged,
    )
    if (!changed) return { url, text: JSON.stringify({ sku, details: details.data, promo: promo.data }) }
    versionsPromise = null // PLUS released a new frontend: reload tokens once.
  }
  throw new Error('PLUS API version keeps changing')
}

export function parsePlusApi(json, url) {
  const product = json.details?.ProductOut
  const o = product?.Overview
  if (!o?.Name) return []
  const ref = json.details.ReferenceQuantity ?? {}
  const pack = packFromAmount(ref.Product_Size, ref.Product_Symbol)
  const price = toCents(o.Price)
  const offer = json.promo?.Offer ?? {}
  const promoPrice = toCents(offer.NewPrice)
  const original = toCents(offer.PriceOriginal_Product)
  // A promotion can cover several articles; only trust its price when it is
  // stated against this article's own regular price.
  const promoApplies = Boolean(offer.PromotionId) && promoPrice > 0 && original === price && promoPrice < price
  const label = offer.DisplayInfo_Label || offer.DisplayInfo_PromotionBasedLabel || null
  return [
    makeRecord({
      retailer: 'plus',
      sourceId: json.sku ?? skuFromUrl(url),
      url: o.Slug ? `${BASE}/product/${o.Slug}` : url,
      name: o.Name,
      brand: o.Brand || null,
      gtin: product.Medicine?.EAN || null,
      category: (product.Categories?.List ?? []).map((c) => c.Name).join(' > ') || null,
      packText: o.Subtitle?.replace(/\s*\(.*\)\s*$/, '') || null,
      pack: pack.amount !== null ? pack : undefined,
      imageUrl: o.Image?.URL || null,
      priceCents: price || null,
      promoPriceCents: promoApplies ? promoPrice : null,
      promoLabel: offer.PromotionId ? label : null,
      promoValidFrom: offer.PromotionId ? offer.StartDate : null,
      promoValidUntil: offer.PromotionId ? offer.EndDate : null,
      availability: o.IsAvailableInStore ? 'available' : price ? 'unknown' : 'unavailable',
    }),
  ]
}

export function parsePlus(text, url) {
  if (text.trimStart().startsWith('{')) return parsePlusApi(JSON.parse(text), url)
  const sku = skuFromUrl(url)
  return parseSchemaOrgPage(text, url, { retailer: 'plus' }).filter((r) => !sku || r.sourceId === sku)
}

export const plus = {
  id: 'plus',
  name: 'PLUS',
  host: 'www.plus.nl',
  status: 'active',
  mode: 'http',
  // Two small JSON calls per product; 4 requests/s keeps ~2 products/s.
  minDelayMs: 250,
  notes: 'OutSystems JSON screen services (details + promotion) incl. EAN; product sitemap',
  async *discover({ fetcher }) {
    for await (const url of walkSitemap(fetcher, `${BASE}/ECP_Sitemap_Engine/rest/Sitemap/product`)) {
      yield { url, kind: 'product' }
    }
  },
  fetch: fetchPlusProduct,
  parse: parsePlus,
}
