// Contract tests per retailer adapter against real (trimmed) product and
// listing pages captured on 2026-10-15. If a retailer changes its markup, the
// live run fails closed (error-rate abort) and these fixtures are refreshed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { getAdapter } from '../scraper/adapters/index.mjs'
import { fetchPlusProduct, parsePlusApiVersions } from '../scraper/adapters/plus.mjs'
import { poieszCategoryUrls, poieszPaging } from '../scraper/adapters/poiesz.mjs'
import { vomarLinks } from '../scraper/adapters/vomar.mjs'

function fixture(name) {
  const html = gunzipSync(readFileSync(new URL(`../fixtures/scraper/${name}.html.gz`, import.meta.url))).toString('utf8')
  const url = /^<!-- (\S+) -->/.exec(html)[1]
  return { html, url }
}

function parse(retailer, name) {
  const { html, url } = fixture(name)
  return getAdapter(retailer).parse(html, url)
}

test('dirk: Nuxt payload product with pack and regular price', () => {
  const [r] = parse('dirk', 'dirk-product')
  assert.equal(r.sourceId, '303')
  assert.equal(r.name, 'Duyvis Oven roasted peanuts salted')
  assert.equal(r.brand, 'Duyvis')
  assert.equal(r.priceCents, 229)
  assert.equal(r.promoPriceCents, null)
  assert.deepEqual([r.packAmount, r.packUnit, r.packCount], [225, 'g', 1])
  assert.equal(r.category, "Snacks & snoep > Noten & pinda's")
})

test('dirk: offer price, label and validity window', () => {
  const [r] = parse('dirk', 'dirk-promo')
  assert.equal(r.name, 'Heineken Pilsener Krat')
  assert.equal(r.priceCents, 1895)
  assert.equal(r.promoPriceCents, 1421)
  assert.equal(r.promoLabel, 'Actie')
  assert.equal(r.promoValidUntil, '2026-10-20T23:59:00.000+02:00')
  assert.deepEqual([r.packAmount, r.packUnit, r.packCount], [300, 'ml', 24])
})

test('dekamarkt: shares the Detailresult parser (product-information key)', () => {
  const [r] = parse('dekamarkt', 'dekamarkt-product')
  assert.equal(r.retailer, 'dekamarkt')
  assert.equal(r.sourceId, '195')
  assert.equal(r.priceCents, 389)
  assert.deepEqual([r.packAmount, r.packUnit, r.packCount], [200, 'ml', 6])
})

test('spar: JSON-LD with GTIN and subtitle pack size', () => {
  const [r] = parse('spar', 'spar-product')
  assert.equal(r.sourceId, '1346946')
  assert.equal(r.gtin, '8711741337974')
  assert.equal(r.priceCents, 269)
  assert.equal(r.packText, '70 Gram')
  assert.deepEqual([r.packAmount, r.packUnit], [70, 'g'])
})

test('spar: discontinued product has no price and is unavailable', () => {
  const [r] = parse('spar', 'spar-discontinued')
  assert.equal(r.priceCents, null)
  assert.equal(r.availability, 'unavailable')
})

test('hoogvliet: JSON-LD price + Next metadata EAN/brand/content', () => {
  const [r] = parse('hoogvliet', 'hoogvliet-product')
  assert.equal(r.sourceId, '989347000')
  assert.equal(r.gtin, '8712692004588')
  assert.equal(r.brand, 'Van der Ende')
  assert.equal(r.priceCents, 419)
  assert.deepEqual([r.packAmount, r.packUnit], [450, 'g'])
  assert.equal(r.category, 'Verse maaltijden, salades > Maaltijden > Oosters')
})

test('aldi: apiData PRODUCT_DETAIL_GET with price tag label', () => {
  const [r] = parse('aldi', 'aldi-product')
  assert.equal(r.sourceId, '91242976')
  assert.equal(r.brand, 'DETTOL')
  assert.equal(r.priceCents, 149)
  assert.equal(r.promoLabel, 'OP=OP')
  assert.deepEqual([r.packAmount, r.packUnit], [250, 'ml'])
})

test('lidl: in-store-only food is recorded with unknown price, never guessed', () => {
  const [r] = parse('lidl', 'lidl-product')
  assert.equal(r.sourceId, '10000488')
  assert.equal(r.name, 'Gyrosreepjes')
  assert.equal(r.priceCents, null)
  assert.deepEqual([r.packAmount, r.packUnit], [450, 'g'])
})

test('plus: rendered JSON-LD with strikethrough price, promo label and window', () => {
  const [r] = parse('plus', 'plus-promo')
  assert.equal(r.sourceId, '100028')
  assert.equal(r.gtin, '8716000014313')
  assert.equal(r.priceCents, 1749)
  assert.equal(r.promoPriceCents, 1349)
  assert.equal(r.promoLabel, '4.00 KORTING')
  assert.equal(r.promoValidFrom, '2026-10-07')
  assert.equal(r.promoValidUntil, '2026-10-20')
})

test('plus: JSON screen-service response (details + promotion) incl. EAN', () => {
  const text = readFileSync(new URL('../fixtures/scraper/plus-api-promo.json', import.meta.url), 'utf8')
  const [r] = getAdapter('plus').parse(text, 'https://www.plus.nl/product/bokma-graanjenever-fles-1000-ml-100028')
  assert.equal(r.sourceId, '100028')
  assert.equal(r.name, 'Bokma Graanjenever')
  assert.equal(r.gtin, '8716000014313')
  assert.equal(r.category, 'Wijn, bier, sterke drank > Sterke dranken > Jenever')
  assert.deepEqual([r.packAmount, r.packUnit, r.packCount], [1000, 'ml', 1])
  assert.equal(r.priceCents, 1749)
  assert.equal(r.promoPriceCents, 1349)
  assert.equal(r.promoLabel, '4.00 KORTING')
  assert.equal(r.promoValidUntil, '2026-10-20')
})

test('plus: promotion price is ignored when stated against another article', () => {
  const json = JSON.parse(readFileSync(new URL('../fixtures/scraper/plus-api-promo.json', import.meta.url), 'utf8'))
  json.promo.Offer.PriceOriginal_Product = '19.99'
  const [r] = getAdapter('plus').parse(JSON.stringify(json), 'https://www.plus.nl/product/x-100028')
  assert.equal(r.promoPriceCents, null)
  assert.equal(r.promoLabel, '4.00 KORTING')
})

test('plus: action versions are read from the OutSystems module and refreshed on change', async () => {
  const js = 'return controller.callDataAction("DataActionGetPromotionOffer", "screenservices/x/DataActionGetPromotionOffer", "PROMO1", function (b) {}); controller.callDataAction("DataActionGetProductDetailsAndAgeInfo", "screenservices/x/D", "DET1", f)'
  assert.deepEqual(parsePlusApiVersions(js), { DataActionGetPromotionOffer: 'PROMO1', DataActionGetProductDetailsAndAgeInfo: 'DET1' })
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/scraper/plus-api-promo.json', import.meta.url), 'utf8'))
  let manifests = 0
  let first = true
  const fetcher = {
    getText: async (url) => {
      if (url.includes('moduleinfo')) {
        manifests += 1
        return JSON.stringify({ manifest: { versionToken: `M${manifests}`, urlVersions: { '/ECOP/scripts/ECP_Product_CW.ProductDetails.PDPContent.mvc.js': '?v' } } })
      }
      return js
    },
    request: async (url, { body }) => {
      const sent = JSON.parse(body)
      assert.equal(sent.screenData.variables.SKU, '100028')
      const stale = first
      first = false
      const data = url.endsWith('PromotionOffer') ? fixture.promo : fixture.details
      return { text: JSON.stringify({ versionInfo: { hasModuleVersionChanged: stale, hasApiVersionChanged: false }, data }) }
    },
  }
  const res = await fetchPlusProduct('https://www.plus.nl/product/bokma-graanjenever-fles-1000-ml-100028', { fetcher })
  assert.ok(manifests >= 1)
  assert.equal(getAdapter('plus').parse(res.text, res.url)[0].promoPriceCents, 1349)
})

test('poiesz: listing page yields all products with EAN, plus tree and paging', () => {
  const { html } = fixture('poiesz-listing')
  const records = parse('poiesz', 'poiesz-listing')
  assert.equal(records.length, 25)
  const heineken = records.find((r) => r.sourceId === '236502')
  assert.equal(heineken.gtin, '8712000033040')
  assert.equal(heineken.priceCents, 1999)
  assert.equal(heineken.promoLabel, '25% korting: 14.99')
  assert.deepEqual([heineken.packAmount, heineken.packUnit], [7200, 'ml'])
  const urls = poieszCategoryUrls(html)
  assert.ok(urls.length > 400, `expected full category tree, got ${urls.length}`)
  assert.ok(urls.includes('https://webwinkel.poiesz-supermarkten.nl/boodschappen/bier/pilsener/pilsener-fles'))
  assert.deepEqual(poieszPaging(html), { page: 1, pageSize: 24, pages: 1, total: 22 })
})

test('vomar: Nuxt 2 listing parsed without executing JavaScript', () => {
  const { html } = fixture('vomar-listing')
  const records = parse('vomar', 'vomar-listing')
  assert.equal(records.length, 95)
  const calve = records.find((r) => r.sourceId === '161144')
  assert.equal(calve.name, 'Calve Pindakaas Stukjes')
  assert.equal(calve.gtin, '8711200430925')
  assert.deepEqual(calve.extraGtins, ['8712100200472', '8722700462989', '8720182127440'])
  assert.equal(calve.priceCents, 319)
  assert.equal(calve.url, 'https://www.vomar.nl/producten/voorraadkast/broodbeleg/calve-pindakaas-stukjes/161144')
  assert.ok(records.every((r) => r.priceCents > 0 && r.name))
  assert.ok(vomarLinks(html, 1).includes('https://www.vomar.nl/producten/voorraadkast'))
})

test('every adapter only emits records for its own retailer', () => {
  for (const [retailer, name] of [
    ['dirk', 'dirk-product'],
    ['spar', 'spar-product'],
    ['vomar', 'vomar-listing'],
    ['poiesz', 'poiesz-listing'],
  ]) {
    for (const r of parse(retailer, name)) assert.equal(r.retailer, retailer)
  }
})
