import type { MatchUnit } from '../../domain/matching.ts'
import {
  quantityUnitLabelNl,
  quantityUnitNameNl,
} from '../../lib/quantityPresentation.ts'

// Product #756: display-only adapter for the human M3 observation collector.
// This file intentionally does not touch the canonical observation schema,
// store evidence or the currently owned ObservationView.tsx.

const observationPackUnits = ['g', 'kg', 'ml', 'l', 'piece'] as const

/** Keep the form's submitted canonical units, localize labels only. */
export const observationPackUnitOptions: ReadonlyArray<{
  readonly value: (typeof observationPackUnits)[number]
  readonly label: string
}> = Object.freeze(
  observationPackUnits.map((value) =>
    Object.freeze({ value, label: quantityUnitNameNl(value) }),
  ),
)

/** Render the line's recorded demand without changing or rounding its amount. */
export function observationRequiredQuantityCopy(
  amount: number | null,
  unit: MatchUnit,
): string {
  const isValidAmount = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
  const displayedAmount = isValidAmount ? String(amount) : '?'

  // A malformed runtime amount must never render NaN or Infinity.
  // Canonical unit/amount ownership remains with the collector/domain.
  return `nodig: ${displayedAmount} ${quantityUnitLabelNl(
    unit,
    isValidAmount ? amount : null,
  )}`
}
