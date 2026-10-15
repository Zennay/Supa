import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent QA: direct RawProductObservation objects can bypass source-specific
// HTML parsers. Domain provenance must never regard embedded credentials or a
// non-standard retailer port as credible PUBLIC checkout source evidence.
// URLs and prices below are entirely synthetic; there are no HTTP requests.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const requirements = [{
  id: 'fictional-milk',
  query: 'halfvolle melk',
  amount: 1500,
  unit: 'ml',
}]

const storeHost = {
  plus: 'www.plus.nl',
  dekamarkt: 'www.dekamarkt.nl',
}
const storePath = {
  plus: '/product/fictional-milk',
  dekamarkt: '/producten/fictional-milk',
}

function observation(shop, cents, url = 'https://' + storeHost[shop] + storePath[shop]) {
  return {
    supermarket: shop,
    sourceProductId: 'fictional-milk-' + shop,
    name: 'Halfvolle melk',
    currentPriceCents: cents,
    currency: 'EUR',
    availability: 'available',
    pack: { rawText: '1 l', amount: 1000, unit: 'ml' },
    offer: null,
    provenance: {
      supermarket: shop,
      kind: 'product',
      url,
      capturedAt: '2026-10-15T09:00:00.000Z',
      sha256: 'a'.repeat(64),
    },
  }
}

function compare(replacedShop, sourceUrl) {
  const plus = observation('plus', 129,
    replacedShop === 'plus' ? sourceUrl : undefined)
  const deka = observation('dekamarkt', 119,
    replacedShop === 'dekamarkt' ? sourceUrl : undefined)
  const inputs = [plus, deka]
  const untouched = JSON.stringify(inputs)
  const result = compareReviewedCatalogs({ requirements, observations: inputs, nowMs: NOW })
  assert.equal(JSON.stringify(inputs), untouched, 'source input cannot be rewritten')
  assert.equal(result.claimable, false, 'offline sources never authorize public savings')
  return result
}

function assertNoWinner(result) {
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.reason, 'invalid_or_stale_source')
}

test('control: ordinary credential-free HTTPS references preserve deterministic preview', () => {
  for (const shop of ['plus', 'dekamarkt']) {
    const observed = observation(shop, 119)
    assert.equal(validateRawProductObservation(observed), observed)
  }
  const r = compare('plus', 'https://www.plus.nl/product/fictional-milk')
  assert.equal(r.comparable, true)
  assert.equal(r.cheaperStore, 'dekamarkt')
  assert.equal(r.savingsCents, 20)
  assert.equal(r.stores.plus.subtotalCents, 258)
  assert.equal(r.stores.dekamarkt.subtotalCents, 238)
})

test('control: explicit default HTTPS port 443 does not change actual origin', () => {
  for (const shop of ['plus', 'dekamarkt']) {
    const url = 'https://' + storeHost[shop] + ':443' + storePath[shop]
    const observed = observation(shop, 119, url)
    assert.equal(validateRawProductObservation(observed), observed)
    const r = compare(shop, url)
    assert.equal(r.comparable, true)
    assert.equal(r.cheaperStore, 'dekamarkt')
  }
})

for (const shop of ['plus', 'dekamarkt']) {
  const host = storeHost[shop]
  const path = storePath[shop]
  for (const [label, url] of [
    ['username userinfo', 'https://fictional-operator@' + host + path],
    ['password userinfo', 'https://fictional-operator:fictional-pass@' + host + path],
    ['non-default HTTPS port', 'https://' + host + ':8443' + path],
  ]) {
    test('expected RED direct source trust: ' + shop + ' ' + label, () => {
      const observed = observation(shop, 119, url)
      // A canonical hostname does not make a private userinfo URL or a
      // different-port service a verified public retailer origin.
      assert.throws(() => validateRawProductObservation(observed),
        /provenance|URL|HTTPS|credential|port|source/i)
    })

    test('expected RED basket claim boundary: ' + shop + ' ' + label, () => {
      const result = compare(shop, url)
      assertNoWinner(result)
      // Financial row metadata must not surface untrusted userinfo as a URL.
      assert.equal(result.lines[0][shop].sourceUrl, null)
    })
  }
}
