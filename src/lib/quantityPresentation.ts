import type { MatchUnit } from '../domain/matching.ts'

/**
 * Translate canonical quantity units only at the presentation boundary.
 * Domain, matching and evidence contracts continue to use the canonical unit.
 */
export function quantityUnitNameNl(unit: MatchUnit): string {
  return unit === 'piece' ? 'stuk' : unit
}

export function quantityUnitLabelNl(unit: MatchUnit, amount: number | null): string {
  if (unit !== 'piece') return quantityUnitNameNl(unit)
  return amount === 1 ? 'stuk' : 'stuks'
}
