import {
  M3_EXPECTED_RETAILERS,
  type M3ObservationSide,
  type ObservationSheet,
} from '../../domain/m3ObservationSheet.ts'

type NextObservationLine = {
  side: M3ObservationSide
  ingredientId: string
} | null

const sideRoleLabels: Record<M3ObservationSide, string> = {
  baseline: 'baseline',
  candidate: 'vergelijking',
}

const storeIdPlaceholders: Record<M3ObservationSide, string> = {
  baseline: 'plus-leiden-...',
  candidate: 'dekamarkt-leiden-...',
}

export function observationSidePresentation(side: M3ObservationSide) {
  const expectedRetailer = M3_EXPECTED_RETAILERS[side]

  return {
    expectedRetailer,
    eyebrow: `${expectedRetailer} · ${sideRoleLabels[side]}`,
    storeIdPlaceholder: storeIdPlaceholders[side],
  }
}

export function observationTimestampFromDate(value: Date): string {
  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}

export function nextObservationActionLabel(
  sheet: ObservationSheet,
  next: NextObservationLine,
): string {
  if (!next) return 'Alle regels zijn gemeten'

  const expectedRetailer = M3_EXPECTED_RETAILERS[next.side]
  const line = sheet[next.side].lines.find(
    (candidate) => candidate.ingredientId === next.ingredientId,
  )

  return line
    ? `Volgende: ${expectedRetailer} · ${line.ingredientLabel}`
    : `Volgende open regel bij ${expectedRetailer}`
}
