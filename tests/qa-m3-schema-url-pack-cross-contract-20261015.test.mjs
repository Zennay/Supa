import test from 'node:test'
import assert from 'node:assert/strict'

import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { structuredSchemaOrgPack } from '../src/data/schemaOrgQuantitativePack.ts'

// Independent cross-module QA: two real production parser entrypoints, but
// ENTIRELY FICTIONAL local JSON-LD data; no retailer network, prices, grants,
// customer details, capture or publishable savings measurements.
const SOURCES = {
  plus: {
    supermarket: 'plus', kind: 'product',
    url: 'https://www.plus.nl/product/qa-m3-physical-pack',
    capturedAt: '2026-10-14T10:00:00Z', sha256: 'a'.repeat(64),
  },
  dekamarkt: {
    supermarket: 'dekamarkt', kind: 'product',
    url: 'https://www.dekamarkt.nl/producten/qa-m3-physical-pack',
    capturedAt: '2026-10-14T10:15:00Z', sha256: 'b'.repeat(64),
  },
}
const SECRET = 'FICTIONAL_PRIVATE_CONTACT_DO_NOT_ECHO'
function fictitious(source, {
  url = source.url, name = 'Fictief winkelproduct', price = '1.25',
  pack = { weight: { value: '0.75', unitCode: 'KGM' } },
  availability = 'https://schema.org/InStock',
  currency = 'EUR',
} = {}) {
  return {
    '@type': 'Product', url, name, sku: 'QA-FICTIONAL-1',
    ...pack,
    offers: {
      '@type': 'Offer', price, priceCurrency: currency, availability,
    },
  }
}
function outcome(graph, source) {
  return parseSchemaOrgProductForPage(graph, source)
}
function observation(graph, source) {
  const result = outcome(graph, source)
  assert.equal(result.type, 'observation', JSON.stringify(result))
  return result.observation
}
function fieldSummary(obs) {
  return {
    source: obs.supermarket, priceCents: obs.currentPriceCents,
    availability: obs.availability,
    pack: { amount: obs.pack.amount, unit: obs.pack.unit },
    origin: obs.provenance,
  }
}
function unrelated(source, price = '0.01') {
  return fictitious(source, {
    url: source.url.replace('/qa-m3-physical-pack', '/different-unrelated-item'),
    name: 'Vreemd fictief aanbevelingsproduct',
    price,
    pack: { size: { value: 100, unitCode: 'MLT' } },
  })
}

test('independent cross-module: recommendation ordering and much lower price never hijack selected retailer product', () => {
  for (const source of Object.values(SOURCES)) {
    const target = fictitious(source)
    const cheap = unrelated(source, '0.01')
    const expensive = unrelated(source, '9999.99')
    const baseline = fieldSummary(observation(target, source))
    for (const decoy of [cheap, expensive]) {
      for (const nodes of [[decoy, target], [target, decoy]]) {
        const selected = fieldSummary(observation({ '@graph': nodes }, source))
        assert.deepEqual(selected, baseline)
        assert.equal(selected.priceCents, 125, 'do not select cheapest recommendation')
        assert.equal(selected.pack.amount, 0.75, 'correct structured physical pack')
        assert.equal(selected.pack.unit, 'kg')
      }
    }
  }
})

test('independent cross-module: GRM/KGM, MLT/LTR/C62 are bound to correct store and source URL', () => {
  const acceptedPacks = [
    [{ weight: { value: 650, unitCode: 'GRM' } }, 650, 'g'],
    [{ weight: { value: '0.25', unitCode: 'KGM' } }, 0.25, 'kg'],
    [{ size: { value: 330, unitCode: 'MLT' } }, 330, 'ml'],
    [{ size: { value: '1.5', unitCode: 'LTR' } }, 1.5, 'l'],
    [{ size: { value: 2, unitCode: 'C62' } }, 2, 'piece'],
  ]
  for (const source of Object.values(SOURCES)) {
    for (const [pack, amount, unit] of acceptedPacks) {
      const p = fictitious(source, { pack })
      const serializedBefore = JSON.stringify(p)
      const result = observation([unrelated(source), p], source)
      assert.equal(result.pack.amount, amount)
      assert.equal(result.pack.unit, unit)
      assert.equal(result.currentPriceCents, 125)
      assert.deepEqual(result.provenance, source)
      assert.equal(result.supermarket, source.supermarket)
      assert.equal(JSON.stringify(p), serializedBefore, 'input must not be mutated')
    }
  }
})

test('independent cross-module: a target with unsafe physical unit must not borrow a recommendation pack', () => {
  for (const source of Object.values(SOURCES)) {
    for (const unsafe of [
      { weight: { value: 500, unitCode: 'MLT' } },
      { weight: { value: 1, unitCode: 'KGM' }, size: { value: 500, unitCode: 'MLT' } },
      { size: { value: 7, unitCode: 'UNKNOWN' } },
      { weight: { value: '1e9', unitCode: 'GRM' } },
      { size: { value: 0, unitCode: 'C62' } },
    ]) {
      const target = fictitious(source, { pack: unsafe })
      assert.equal(structuredSchemaOrgPack(target).status, 'unsafe')
      const result = outcome([unrelated(source), target], source)
      assert.equal(result.type, 'abstain')
      assert.match(result.reason, /ambiguous physical packaging/)
    }
  }
})

test('independent cross-module: duplicate, absent and contradictory URLs cannot become a 22-line basket price', () => {
  for (const source of Object.values(SOURCES)) {
    const matching = fictitious(source)
    const foreign = unrelated(source)
    const { url, ...missingUrl } = foreign
    const cases = [
      [matching, matching],
      [matching, missingUrl],
      [foreign, foreign],
      [matching, { ...foreign, url: 'http://example.invalid/insecure' }],
    ]
    for (const graph of cases) {
      const result = outcome({ '@graph': graph }, source)
      assert.equal(result.type, 'abstain', 'no first/cheapest fallback for unsafe multi-Product graphs')
      assert.equal('observation' in result, false)
    }
  }
})

test('independent cross-module: contradictory retailer origin refuses even a cheap valid-looking offer', () => {
  const plusProduct = fictitious(SOURCES.plus, { price: '0.01' })
  const dekaProduct = fictitious(SOURCES.dekamarkt, { price: '0.01' })
  assert.equal(outcome(plusProduct, SOURCES.dekamarkt).type, 'abstain')
  assert.equal(outcome(dekaProduct, SOURCES.plus).type, 'abstain')
  for (const source of Object.values(SOURCES)) {
    for (const wrongOrigin of [
      { ...source, url: source.url + '#private' },
      { ...source, kind: 'catalog' },
      { ...source, url: 'https://user@' + new URL(source.url).hostname + new URL(source.url).pathname },
      { ...source, url: source.url.replace('https:', 'http:') },
      { ...source, url: 'https://retailer.example.invalid/product/qa' },
    ]) {
      assert.equal(outcome(fictitious(source), wrongOrigin).type, 'abstain')
    }
  }
})

test('independent cross-module: privacy and malformed offer poison never appear in abstention reason', () => {
  for (const source of Object.values(SOURCES)) {
    const poison = fictitious(source, { currency: SECRET })
    const currency = outcome({ '@graph': [unrelated(source), poison] }, source)
    assert.equal(currency.type, 'abstain')
    assert.equal(currency.reason.includes(SECRET), false)
    const accessor = fictitious(source)
    const offers = {}
    Object.defineProperty(offers, 'price', {
      get() { throw new Error(SECRET) },
    })
    Object.defineProperty(offers, '@type', { value: 'Offer', enumerable: true })
    accessor.offers = offers
    const result = outcome([unrelated(source), accessor], source)
    assert.equal(result.type, 'abstain')
    assert.equal(result.reason.includes(SECRET), false)
  }
})

test('independent cross-module: unrelated product getter is not consulted after exact target binding', () => {
  const source = SOURCES.plus
  const decoy = unrelated(source)
  Object.defineProperty(decoy, 'offers', {
    get() { throw new Error(SECRET) },
  })
  // Selection reads only own URL and type of the unrelated recommendation;
  // its poisoned pricing metadata must never be used for the selected item.
  const result = outcome([decoy, fictitious(source)], source)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 125)
})

test('independent cross-module: unknown target stock never promotes a priced recommendation', () => {
  for (const source of Object.values(SOURCES)) {
    const target = fictitious(source, { availability: 'https://schema.org/PreOrder' })
    const result = outcome([unrelated(source), target], source)
    assert.equal(result.type, 'observation')
    assert.equal(result.observation.availability, 'unknown')
    assert.equal(result.observation.currentPriceCents, 125)
    assert.equal(result.observation.provenance.url, source.url)
    // A private basket comparator must subsequently treat unknown stock as
    // unresolved; this parser never asserts savings, best store, or claim.
    assert.equal('savingsCents' in result.observation, false)
    assert.equal('claimable' in result.observation, false)
  }
})
