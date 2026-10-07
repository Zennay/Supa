import {
  M3_EXPECTED_RETAILERS,
  type M3ObservationSide,
} from '../../domain/m3ObservationSheet.ts'

export type ObservationRetailerCopy = {
  eyebrow: string
  expectedRetailer: string
  emptyStoreLabel: string
  storePlaceholder: string
  storeIdPlaceholder: string
  guidance: string
}

function assertObservationSide(side: unknown): asserts side is M3ObservationSide {
  if (side !== 'baseline' && side !== 'candidate') {
    throw new Error('Unknown M3 observation side')
  }
}

export function observationRetailerCopy(
  side: M3ObservationSide,
): ObservationRetailerCopy {
  assertObservationSide(side)
  const expectedRetailer = M3_EXPECTED_RETAILERS[side]

  return {
    eyebrow:
      side === 'baseline'
        ? `Eerste winkel · ${expectedRetailer}`
        : `Vergelijkwinkel · ${expectedRetailer}`,
    expectedRetailer,
    emptyStoreLabel: `${expectedRetailer} nog niet ingevuld`,
    storePlaceholder: `Bijv. ${expectedRetailer} Leiden`,
    storeIdPlaceholder:
      side === 'baseline' ? 'plus-leiden-...' : 'dekamarkt-leiden-...',
    guidance:
      side === 'baseline'
        ? `Meet deze mand eerst bij ${expectedRetailer}. Gebruik hier geen andere supermarkt, anders kan SUPA de winkels niet betrouwbaar vergelijken.`
        : `Meet daarna dezelfde mand bij ${expectedRetailer}. Gebruik hier geen andere supermarkt, anders kan SUPA de winkels niet betrouwbaar vergelijken.`,
  }
}
