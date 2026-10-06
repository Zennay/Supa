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
        ? `Baseline · ${expectedRetailer}`
        : `Vergelijking · ${expectedRetailer}`,
    expectedRetailer,
    emptyStoreLabel: `${expectedRetailer} nog niet ingevuld`,
    storePlaceholder: `Bijv. ${expectedRetailer} Leiden`,
    storeIdPlaceholder:
      side === 'baseline' ? 'plus-leiden-...' : 'dekamarkt-leiden-...',
    guidance:
      side === 'baseline'
        ? 'Voor deze M3-meting hoort de baseline bij PLUS. Een andere supermarkt wordt door de preflight geweigerd.'
        : 'Voor deze M3-meting hoort de vergelijking bij DekaMarkt. Een andere supermarkt wordt door de preflight geweigerd.',
  }
}
