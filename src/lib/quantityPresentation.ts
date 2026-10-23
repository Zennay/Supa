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

const formatMetricAmount = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 12 })

/**
 * Render canonical demand quantities in a compact metric form without changing
 * the underlying evidence value: large grams/millilitres display as kg/litre.
 */
export function quantityAmountLabelNl(amount: number | null, unit: unknown): string {
  const canonicalUnit = canonicalPresentationUnit(unit)
  if (amount === null || !Number.isFinite(amount)) {
    return `? ${quantityUnitLabelNl(canonicalUnit, null)}`
  }
  if (canonicalUnit === 'g' && amount >= 1000) {
    return `${formatMetricAmount.format(amount / 1000)} kg`
  }
  if (canonicalUnit === 'ml' && amount >= 1000) {
    return `${formatMetricAmount.format(amount / 1000)} l`
  }
  return `${formatMetricAmount.format(amount)} ${quantityUnitLabelNl(canonicalUnit, amount)}`
}
