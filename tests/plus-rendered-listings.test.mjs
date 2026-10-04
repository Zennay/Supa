import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  PLUS_RENDERED_LISTING_SELECTORS,
  parsePlusRenderedCatalogEvidence,
  parsePlusRenderedOffersEvidence,
} from '../src/data/plusRenderedListings.ts'

const catalogUrl = new URL(
  '../fixtures/m1/plus-rendered-catalog.v1.json',
  import.meta.url,
)
const offersUrl = new URL(
  '../fixtures/m1/plus-rendered-offers.v1.json',
  import.meta.url,
)

async function fixture(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}

test('parses reviewed PLUS rendered catalog cards from exact observed DOM contract', async () => {
  const result = parsePlusRenderedCatalogEvidence(await fixture(catalogUrl))

  assert.equal(result.type, 'observations')
  assert.equal(result.abstained, 0)
  assert.equal(result.observations.length, 4)

  const milk = result.observations.find(
    (observation) => observation.sourceProductId === '579010',
  )
  assert.ok(milk)
  assert.equal(milk.name, 'Zuivelmeester Halfvolle melk')
  assert.equal(milk.currentPriceCents, 85)
  assert.deepEqual(milk.pack, {
    rawText: 'Per 1000 ml',
    amount: 1000,
    unit: 'ml',
  })
  assert.equal(milk.offer, null)
  assert.equal(milk.availability, 'unknown')
})

test('parses reviewed PLUS rendered offer cards without guessing mechanics or validity', async () => {
  const result = parsePlusRenderedOffersEvidence(await fixture(offersUrl))

  assert.equal(result.type, 'observations')
  assert.equal(result.abstained, 0)
  assert.equal(result.observations.length, 4)

  const bananas = result.observations.find(
    (observation) => observation.sourceProductId === '113651',
  )
  assert.ok(bananas)
  assert.equal(bananas.currentPriceCents, 99)
  assert.deepEqual(bananas.pack, {
    rawText: 'Per 1000 gram',
    amount: 1000,
    unit: 'g',
  })
  assert.deepEqual(bananas.offer, {
    label: '0.99 / 2.29',
    mechanics: null,
    offerPriceCents: 99,
    originalPriceCents: 229,
    validFrom: null,
    validTo: null,
  })
})

test('cross-page evidence corroborates the observed PLUS banana original price', async () => {
  const catalog = parsePlusRenderedCatalogEvidence(await fixture(catalogUrl))
  const offers = parsePlusRenderedOffersEvidence(await fixture(offersUrl))

  assert.equal(catalog.type, 'observations')
  assert.equal(offers.type, 'observations')

  const catalogBananas = catalog.observations.find(
    (observation) => observation.sourceProductId === '113651',
  )
  const offerBananas = offers.observations.find(
    (observation) => observation.sourceProductId === '113651',
  )

  assert.ok(catalogBananas)
  assert.ok(offerBananas)
  assert.equal(catalogBananas.currentPriceCents, 229)
  assert.equal(offerBananas.offer.originalPriceCents, 229)
  assert.equal(offerBananas.currentPriceCents, 99)
})

test('listing parser fails closed when the observed block marker drifts', async () => {
  const evidence = await fixture(catalogUrl)
  evidence.cards[0].block = 'ProductList.FutureItem'

  const result = parsePlusRenderedCatalogEvidence(evidence)

  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 3)
  assert.equal(result.abstained, 1)
})

test('offer card without a real discount is skipped instead of becoming savings truth', async () => {
  const evidence = await fixture(offersUrl)
  evidence.cards[0].previousPriceText = '0.99'

  const result = parsePlusRenderedOffersEvidence(evidence)

  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 3)
  assert.equal(result.abstained, 1)
})

test('listing evidence rejects selector-contract or acquisition-safety drift', async () => {
  const selectorDrift = await fixture(catalogUrl)
  selectorDrift.browserEvidence.selectorContract.name = '.guessed-name'

  assert.deepEqual(parsePlusRenderedCatalogEvidence(selectorDrift), {
    type: 'abstain',
    reason: 'PLUS rendered evidence violates the bounded browser trust contract',
  })

  const unsafe = await fixture(catalogUrl)
  unsafe.browserEvidence.safety.networkInterception = true

  assert.deepEqual(parsePlusRenderedCatalogEvidence(unsafe), {
    type: 'abstain',
    reason: 'PLUS rendered evidence violates the bounded browser trust contract',
  })

  assert.equal(
    PLUS_RENDERED_LISTING_SELECTORS.catalogBlock,
    'ProductList.ProductItem',
  )
  assert.equal(
    PLUS_RENDERED_LISTING_SELECTORS.offersBlock,
    'PromotionListFlow.OfferItem',
  )
})
