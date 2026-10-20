import assert from 'node:assert/strict'
import test from 'node:test'
import { parseM3OfflineProductHtml } from '../scripts/m3-offline-html-product.mjs'

/**
 * Independent offline-only M3 quality acceptance. Every price, URL slug, and
 * capture timestamp here is invented; this suite does not contact retailers.
 * The result of source validation must be the same immutable source identity
 * handed to the parser and returned to the operator. A getter/proxy must not
 * change which supermarket/page a saved HTML observation purports to belong to.
 */
const plus = 'https://www.plus.nl/product/qa-invented-chicken'
const deka = 'https://www.dekamarkt.nl/producten/qa-invented-chicken'
const capturedAt = '2026-10-15T10:00:00Z'

function htmlFor(url) {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    url,
    name: 'QA FICTIONAL CHICKEN',
    sku: 'QA-FICTIONAL-001',
    weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
    offers: {
      '@type': 'Offer', price: '2.45', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }
  return '<script type="application/ld+json">' + JSON.stringify(product) + '</script>'
}
function inspect(source, html = htmlFor(deka)) {
  return parseM3OfflineProductHtml({ source, html, capturedAt })
}
function refused(result) {
  assert.equal(result.type, 'abstain')
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_QA_SOURCE_MARKER_1838/)
}

test('ordinary independent own-data PLUS and Deka records remain accepted as *private* offline previews', () => {
  for (const [supermarket, url] of [['plus', plus], ['dekamarkt', deka]]) {
    const result = inspect({ supermarket, kind: 'product', url }, htmlFor(url))
    assert.equal(result.type, 'observation')
    assert.equal(result.provenance.supermarket, supermarket)
    assert.equal(result.provenance.url, url)
    assert.equal(result.observation.provenance.url, url)
    assert.equal(result.observation.currentPriceCents, 245)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.evidenceStatus, 'offline-preview-not-retailer-verification')
  }
})

test('source.url and source.supermarket getters cannot swap PLUS validation for Deka provenance', () => {
  let urlReads = 0
  let marketReads = 0
  const source = {
    kind: 'product',
    get supermarket() {
      marketReads += 1
      return marketReads === 1 ? 'plus' : 'dekamarkt'
    },
    get url() {
      urlReads += 1
      return urlReads <= 3 ? plus : deka
    },
  }
  // A hostile accessor currently passes the early PLUS source check but
  // can change the later provenance object used to select a Deka Product.
  refused(inspect(source))
})

test('an inherited source identity must not become a verified offline observation', () => {
  const source = Object.create({
    kind: 'product', supermarket: 'dekamarkt', url: deka,
    privateLabel: 'PRIVATE_QA_SOURCE_MARKER_1838',
  })
  refused(inspect(source))
})

test('a Proxy that changes the trusted source between validation and parsing fails closed', () => {
  const reads = { url: 0, supermarket: 0 }
  const source = new Proxy({ kind: 'product', supermarket: 'plus', url: plus }, {
    get(target, key, receiver) {
      if (key === 'url') {
        reads.url += 1
        return reads.url <= 3 ? plus : deka
      }
      if (key === 'supermarket') {
        reads.supermarket += 1
        return reads.supermarket === 1 ? 'plus' : 'dekamarkt'
      }
      return Reflect.get(target, key, receiver)
    },
  })
  refused(inspect(source))
})
