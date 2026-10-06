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

export function observationTimestampFromDate(value: unknown): string {
  if (!(value instanceof Date)) return ''

  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}

export function observationPriceCents(value: unknown): number | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().replace(',', '.')
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) {
    return null
  }

  const [eurosPart, fractionalPart = ''] = normalized.split('.')
  const euros = eurosPart === '' ? 0 : Number(eurosPart)
  const fractionalCents = Number(fractionalPart.padEnd(2, '0'))
  const cents = euros * 100 + fractionalCents

  return Number.isSafeInteger(euros) && Number.isSafeInteger(cents)
    ? cents
    : null
}
