import type { MatchUnit } from '../../domain/matching.ts'
import {
  observationPackUnitOptions,
  observationRequiredQuantityCopy,
} from './observationQuantityPresentation.ts'

/**
 * #756 integration-ready line label for the owned M3 collector.
 * Presentation only: the canonical requirement remains unchanged.
 */
export function ObservationRequirementText({
  amount,
  unit,
}: {
  amount: number | null
  unit: MatchUnit
}) {
  return <span>{observationRequiredQuantityCopy(amount, unit)}</span>
}

/**
 * #756 integration-ready children for the pack-unit <select>.
 * Keep option values canonical for the existing M3 schema/converter.
 */
export function ObservationPackUnitOptions() {
  return (
    <>
      {observationPackUnitOptions.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  )
}
