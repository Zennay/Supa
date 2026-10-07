import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  parseDekaMarktSsrCatalogEvidence,
  parseDekaMarktSsrOffersEvidence,
} from '../src/data/dekaMarktSsrListings.ts'

const catalogUrl = new URL(
  '../fixtures/m1/dekamarkt-catalog-melk.v1.json',
  import.meta.url,
)
const offersUrl = new URL(
  '../fixtures/m1/dekamarkt-offers.v1.json',
  import.meta.url,
)

async function fixture(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}

test('parses exact DekaMarkt milk catalog SSR evidence into trusted observations', async () => {
  const result = parseDekaMarktSsrCatalogEvidence(await fixture(catalogUrl))

  assert.equal(result.type, 'observations')
  assert.equal(result.abstained, 0)
  assert.equal(result.observations.length, 3)
  assert.deepEqual(
    result.observations.map((observation) => ({
      id: observation.sourceProductId,
      name: observation.name,
      cents: observation.currentPriceCents,
      pack: observation.pack,
      offer: observation.offer,
    })),
    [
      {
        id: '115873',
        name: 'Zuivelmeester Halfvolle melk',
        cents: 85,
        pack: { rawText: '1 liter', amount: 1, unit: 'l' },
        offer: null,
      },
      {
        id: '101229',
        name: 'Zuivelmeester Halfvolle melk',
        cents: 169,
        pack: { rawText: '2 liter', amount: 2, unit: 'l' },
        offer: null,
      },
      {
        id: '6279',
        name: 'Melkunie Karnemelk',
        cents: 145,
        pack: { rawText: '1 liter', amount: 1, unit: 'l' },
        offer: null,
      },
    ],
  )
})

test('catalog parser skips one source record instead of guessing offer semantics', async () => {
  const evidence = await fixture(catalogUrl)
  // Product 101229 price object is at payload index 18.
  evidence.nuxtPayload[18].isOffer = 0 // index 0 dereferences to null, not boolean false

  const result = parseDekaMarktSsrCatalogEvidence(evidence)

  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 2)
  assert.equal(result.abstained, 1)
  assert.deepEqual(
    result.observations.map((observation) => observation.sourceProductId),
    ['115873', '6279'],
  )
})

test('parses exact DekaMarkt offer SSR records with explicit source prices and validity', async () => {
  const result = parseDekaMarktSsrOffersEvidence(await fixture(offersUrl))

  assert.equal(result.type, 'observations')
  assert.equal(result.abstained, 0)
  assert.deepEqual(
    result.observations.map((observation) => ({
      id: observation.sourceProductId,
      name: observation.name,
      cents: observation.currentPriceCents,
      pack: observation.pack,
      offer: observation.offer,
    })),
    [
      {
        id: '47936',
        name: 'Croma Vloeibaar',
        cents: 199,
        pack: { rawText: '750 ml', amount: 750, unit: 'ml' },
        offer: {
          label: 'per stuk 1,99',
          mechanics: null,
          offerPriceCents: 199,
          originalPriceCents: 449,
          validFrom: '2026-09-29T00:00:00.000Z',
          validTo: '2026-10-05T00:00:00.000Z',
        },
      },
      {
        id: '4579',
        name: 'Del Monte Bananen',
        cents: 89,
        pack: { rawText: '1 kg (ca. 5 stuks)', amount: 1, unit: 'kg' },
        offer: {
          label: 'per kilo 0,89',
          mechanics: null,
          offerPriceCents: 89,
          originalPriceCents: 199,
          validFrom: '2026-09-29T00:00:00.000Z',
          validTo: '2026-10-05T00:00:00.000Z',
        },
      },
      {
        id: '57593',
        name: 'Nutella Hazelnootpasta',
        cents: 299,
        pack: { rawText: '450 g', amount: 450, unit: 'g' },
        offer: {
          label: 'per stuk 2,99',
          mechanics: null,
          offerPriceCents: 299,
          originalPriceCents: 459,
          validFrom: '2026-09-29T00:00:00.000Z',
          validTo: '2026-10-05T00:00:00.000Z',
        },
      },
    ],
  )
})

test('offers parser skips price disagreement instead of inferring weight-price semantics', async () => {
  const evidence = await fixture(offersUrl)
  // First linked product is payload index 15. Its offerPrice ref normally points
  // to index 5 (1.99); point it to index 20 (0.89) to force disagreement.
  evidence.nuxtPayload[15].offerPrice = 20

  const result = parseDekaMarktSsrOffersEvidence(evidence)

  assert.equal(result.type, 'observations')
  assert.equal(result.observations.length, 2)
  assert.equal(result.abstained, 1)
  assert.deepEqual(
    result.observations.map((observation) => observation.sourceProductId),
    ['4579', '57593'],
  )
})

test('listing evidence rejects unsafe acquisition metadata', async () => {
  const evidence = await fixture(catalogUrl)
  evidence.captureEvidence.safety.antiBotBypass = true

  assert.deepEqual(parseDekaMarktSsrCatalogEvidence(evidence), {
    type: 'abstain',
    reason: 'DekaMarkt evidence violates the bounded capture contract',
  })
})


test('DekaMarkt listing evidence binds catalog and offers kinds to their public routes', async () => {
  const catalogOnOffersRoute = await fixture(catalogUrl)
  catalogOnOffersRoute.source.url = 'https://www.dekamarkt.nl/aanbiedingen'

  assert.deepEqual(parseDekaMarktSsrCatalogEvidence(catalogOnOffersRoute), {
    type: 'abstain',
    reason: 'DekaMarkt evidence source route does not match catalog',
  })

  const offersOnCatalogRoute = await fixture(offersUrl)
  offersOnCatalogRoute.source.url =
    'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk'

  assert.deepEqual(parseDekaMarktSsrOffersEvidence(offersOnCatalogRoute), {
    type: 'abstain',
    reason: 'DekaMarkt evidence source route does not match offers',
  })

  const catalogRootOnly = await fixture(catalogUrl)
  catalogRootOnly.source.url = 'https://www.dekamarkt.nl/producten'

  assert.deepEqual(parseDekaMarktSsrCatalogEvidence(catalogRootOnly), {
    type: 'abstain',
    reason: 'DekaMarkt evidence source route does not match catalog',
  })
})


test('DekaMarkt listing evidence rejects credential-bearing public source URLs', async () => {
  for (const [fixtureUrl, sourceUrl, parse] of [
    [
      catalogUrl,
      'https://reporter@www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk',
      parseDekaMarktSsrCatalogEvidence,
    ],
    [
      offersUrl,
      'https://:secret@www.dekamarkt.nl/aanbiedingen',
      parseDekaMarktSsrOffersEvidence,
    ],
  ]) {
    const evidence = await fixture(fixtureUrl)
    evidence.source.url = sourceUrl

    assert.deepEqual(parse(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt evidence source must use the credential-free public HTTPS host',
    })
  }
})


test('DekaMarkt listing evidence rejects non-default ports but accepts canonical HTTPS 443', async () => {
  const nonDefault = await fixture(catalogUrl)
  nonDefault.source.url =
    'https://www.dekamarkt.nl:8443/producten/zuivel-kaas/melk-karnemelk'

  assert.deepEqual(parseDekaMarktSsrCatalogEvidence(nonDefault), {
    type: 'abstain',
    reason: 'DekaMarkt evidence source must use the credential-free public HTTPS host',
  })

  const explicitDefault = await fixture(catalogUrl)
  explicitDefault.source.url =
    'https://www.dekamarkt.nl:443/producten/zuivel-kaas/melk-karnemelk'

  assert.equal(parseDekaMarktSsrCatalogEvidence(explicitDefault).type, 'observations')
})

test('DekaMarkt listing evidence requires a timezone-bearing capture timestamp', async () => {
  for (const capturedAt of [
    '2026-10-04',
    '2026-10-04T18:15:29.695',
    '2026-02-30T18:15:29.695Z',
    '2026-10-04T24:00:00Z',
    '2026-10-04T18:15:29+24:00',
  ]) {
    const evidence = await fixture(catalogUrl)
    evidence.source.capturedAt = capturedAt

    assert.deepEqual(parseDekaMarktSsrCatalogEvidence(evidence), {
      type: 'abstain',
      reason: 'DekaMarkt evidence source provenance is incomplete',
    })
  }

  const offset = await fixture(catalogUrl)
  offset.source.capturedAt = '2026-10-04T20:15:29.695+02:00'
  assert.equal(parseDekaMarktSsrCatalogEvidence(offset).type, 'observations')
})
