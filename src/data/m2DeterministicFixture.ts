import type { RawProductObservation } from './ingestion'
import type { M2PlanItem, M2Recipe } from '../domain/basket'

export const m2DekaMarktObservations: RawProductObservation[] = [
  {
    supermarket: 'dekamarkt',
    sourceProductId: '115873',
    name: 'Zuivelmeester Halfvolle melk',
    currentPriceCents: 85,
    currency: 'EUR',
    pack: {
      rawText: '1 liter',
      amount: 1,
      unit: 'l',
    },
    offer: null,
    availability: 'unknown',
    provenance: {
      supermarket: 'dekamarkt',
      kind: 'catalog',
      url: 'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk',
      capturedAt: '2026-10-04T18:15:30.306Z',
      sha256: '6666d3ed68bee4306bae95be7a7acf3e5867649cc79a5e6e2c80e7eb08c60a1d',
    },
  },
  {
    supermarket: 'dekamarkt',
    sourceProductId: '4579',
    name: 'Del Monte Bananen',
    currentPriceCents: 89,
    currency: 'EUR',
    pack: {
      rawText: '1 kg (ca. 5 stuks)',
      amount: 1,
      unit: 'kg',
    },
    offer: {
      label: 'per kilo 0,89',
      mechanics: null,
      offerPriceCents: 89,
      originalPriceCents: 199,
      validFrom: '2026-09-29T00:00:00.000Z',
      validTo: '2026-10-05T00:00:00.000Z',
    },
    availability: 'unknown',
    provenance: {
      supermarket: 'dekamarkt',
      kind: 'offers',
      url: 'https://www.dekamarkt.nl/aanbiedingen',
      capturedAt: '2026-10-04T18:15:30.693Z',
      sha256: '0240e5ba658748bcc553d3cee1728c140b68473fc3f72dade699783d73c9f2a0',
    },
  },
  {
    supermarket: 'dekamarkt',
    sourceProductId: '57593',
    name: 'Nutella Hazelnootpasta',
    currentPriceCents: 299,
    currency: 'EUR',
    pack: {
      rawText: '450 g',
      amount: 450,
      unit: 'g',
    },
    offer: {
      label: 'per stuk 2,99',
      mechanics: null,
      offerPriceCents: 299,
      originalPriceCents: 459,
      validFrom: '2026-09-29T00:00:00.000Z',
      validTo: '2026-10-05T00:00:00.000Z',
    },
    availability: 'unknown',
    provenance: {
      supermarket: 'dekamarkt',
      kind: 'offers',
      url: 'https://www.dekamarkt.nl/aanbiedingen',
      capturedAt: '2026-10-04T18:15:30.693Z',
      sha256: '0240e5ba658748bcc553d3cee1728c140b68473fc3f72dade699783d73c9f2a0',
    },
  },
]

export const m2Recipes: M2Recipe[] = [
  {
    id: 'banana-nutella-shake',
    title: 'Banaan-hazelnoot shake',
    ingredients: [
      {
        id: 'halfvolle-melk',
        label: 'Halfvolle melk',
        query: 'Zuivelmeester Halfvolle melk',
        amount: 1000,
        unit: 'ml',
      },
      {
        id: 'bananen',
        label: 'Bananen',
        query: 'Del Monte Bananen',
        amount: 300,
        unit: 'g',
      },
      {
        id: 'hazelnootpasta',
        label: 'Hazelnootpasta',
        query: 'Nutella Hazelnootpasta',
        amount: 100,
        unit: 'g',
      },
    ],
  },
]

export const m2Plan: M2PlanItem[] = [
  { day: 'Ma', recipeId: 'banana-nutella-shake' },
  { day: 'Do', recipeId: 'banana-nutella-shake' },
]
