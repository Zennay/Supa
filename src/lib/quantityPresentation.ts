import type { MatchUnit } from '../domain/matching.ts'

const MATCH_UNITS = new Set<MatchUnit>(['g', 'kg', 'ml', 'l', 'piece', 'unknown'])

function canonicalPresentationUnit(unit: unknown): MatchUnit {
  if (typeof unit !== 'string' || !MATCH_UNITS.has(unit as MatchUnit)) {
    return 'unknown'
  }

  return unit as MatchUnit
}

/**
 * Translate canonical quantity units only at the presentation boundary.
 * Domain, matching and evidence contracts continue to use the canonical unit.
 */
export function quantityUnitNameNl(unit: unknown): string {
  const canonicalUnit = canonicalPresentationUnit(unit)
  if (canonicalUnit === 'piece') return 'stuk'
  if (canonicalUnit === 'unknown') return 'onbekend'
  return canonicalUnit
}

export function quantityUnitLabelNl(unit: unknown, amount: number | null): string {
  const canonicalUnit = canonicalPresentationUnit(unit)
  if (canonicalUnit !== 'piece') return quantityUnitNameNl(canonicalUnit)
  return amount === 1 ? 'stuk' : 'stuks'
}
