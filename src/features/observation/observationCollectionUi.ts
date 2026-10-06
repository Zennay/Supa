import {
  M3_EXPECTED_RETAILERS,
  type M3ObservationSide,
  type ObservationSheet,
} from '../../domain/m3ObservationSheet.ts'

export type NextObservationLine = {
  side: M3ObservationSide
  ingredientId: string
} | null

export function nextObservationActionLabel(
  sheet: ObservationSheet,
  next: NextObservationLine,
): string {
  if (!next) return 'Alle regels zijn gemeten'

  const retailer = M3_EXPECTED_RETAILERS[next.side]
  const line = sheet[next.side].lines.find(
    (candidate) => candidate.ingredientId === next.ingredientId,
  )

  return line
    ? `Volgende: ${retailer} · ${line.ingredientLabel}`
    : `Volgende open regel bij ${retailer}`
}

export function observationTimestampFromDate(value: Date): string {
  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}
