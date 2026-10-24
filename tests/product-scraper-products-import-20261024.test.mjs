import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import {
  PLUS_RENDERED_LISTING_IMAGE_SELECTOR as IMG,
  PLUS_RENDERED_LISTING_SELECTORS as CSS,
  projectPlusRenderedListingCard,
} from '../src/data/plusRenderedListings.ts'
import {
  mergeScraperProducts,
  productsFromScraperFile,
  readScraperProducts,
  safeRetailerImageUrl,
  unitPriceCents,
  writeScraperProducts,
} from '../src/features/products/scraperProducts.ts'

const fixtureDir = new URL('../fixtures/m1/', import.meta.url)
const fixture = name => readFileSync(new URL(name, fixtureDir), 'utf8')

test('every committed PLUS/DekaMarkt scraper evidence file imports into Producten', () => {
  const files = readdirSync(fixtureDir).filter(name => name.endsWith('.json'))
  assert.equal(files.length, 6)
  let all = []
  for (const name of files) {
    const products = productsFromScraperFile(fixture(name))
    assert.ok(products.length > 0, name)
    for (const product of products) {
      assert.match(product.id, /^(plus|dekamarkt):\d+$/)
      assert.ok(product.store === 'PLUS' || product.store === 'DekaMarkt')
      assert.ok(product.priceCents === null || Number.isSafeInteger(product.priceCents))
      assert.ok(!Number.isNaN(Date.parse(product.capturedAt)))
    }
    all = mergeScraperProducts(all, products)
  }
  assert.equal(all.length, 13)
  // The PLUS product page carries the scraped product photo.
  const milk = all.find(product => product.id === 'plus:579010')
  assert.match(milk.imageUrl, /^https:\/\/images\.ctfassets\.net\//)
  // Offers keep the observed original price next to the offer price.
  const croma = all.find(product => product.id === 'dekamarkt:47936')
  assert.equal(croma.priceCents, 199)
  assert.equal(croma.originalPriceCents, 449)
})

test('merge keeps the newest known price and any image across files', () => {
  const listing = { id: 'plus:1', store: 'PLUS', name: 'A', priceCents: 129, originalPriceCents: null, packLabel: '1 kg',
    packAmount: 1, packUnit: 'kg', capturedAt: '2026-10-04T18:00:00Z', imageUrl: null, sourceUrl: null }
  const page = { ...listing, priceCents: null, capturedAt: '2026-10-05T18:00:00Z',
    imageUrl: 'https://images.ctfassets.net/x/1.png' }
  const [merged] = mergeScraperProducts([listing], [page])
  assert.equal(merged.priceCents, 129)
  assert.equal(merged.imageUrl, 'https://images.ctfassets.net/x/1.png')
  assert.deepEqual(unitPriceCents(merged), { cents: 129, unit: 'kg' })
})

test('only https retailer image CDNs are accepted and storage round-trips', () => {
  assert.equal(safeRetailerImageUrl('http://images.ctfassets.net/a.png'), null)
  assert.equal(safeRetailerImageUrl('https://evil.example/a.png'), null)
  assert.equal(safeRetailerImageUrl('javascript:alert(1)'), null)
  const store = new Map()
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }
  const products = productsFromScraperFile(fixture('plus-rendered-catalog.v1.json'))
  writeScraperProducts(storage, products)
  assert.deepEqual(readScraperProducts(storage), products)
  assert.throws(() => productsFromScraperFile('{"schema":"something-else"}'), /Onbekend/)
  assert.throws(() => productsFromScraperFile('<html>'), /geen geldig scraperbestand/)
})

test('PLUS card projection keeps exactly one product photo from the PLUS image CDN', () => {
  const list = items => Object.assign([...items], { item(index) { return this[index] ?? null } })
  const card = images => {
    const values = {
      [CSS.name]: ['Fictional oats'], [CSS.pack]: ['Per 500 gram'],
      [CSS.priceInteger]: ['2.'], [CSS.priceDecimals]: ['49'], [CSS.previousPrice]: [],
    }
    const anchors = []
    const block = {
      querySelectorAll(selector) {
        if (selector === CSS.cardAnchor) return list(anchors)
        if (selector === IMG) return list(images.map(src => ({ getAttribute: name => name === 'src' ? src : null })))
        return list((values[selector] ?? []).map(text => ({ textContent: text })))
      },
    }
    const anchor = {
      matches: selector => selector === CSS.cardAnchor,
      closest: () => block,
      getAttribute: name => name === 'href' ? '/product/fictional-oats-123456' : null,
    }
    anchors.push(anchor)
    return projectPlusRenderedListingCard(anchor, 'catalog')
  }
  assert.equal(card(['https://images.ctfassets.net/s/123456.png']).imageSrc, 'https://images.ctfassets.net/s/123456.png')
  assert.equal(Object.hasOwn(card([]), 'imageSrc'), false)
  assert.equal(Object.hasOwn(card(['https://tracker.example/p.gif']), 'imageSrc'), false)
  assert.equal(Object.hasOwn(card(['https://images.ctfassets.net/a.png', 'https://images.ctfassets.net/b.png']), 'imageSrc'), false)
})
