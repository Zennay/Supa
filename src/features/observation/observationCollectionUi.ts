import {
  M3_EXPECTED_RETAILERS,
  type M3ObservationSide,
  type ObservationSheet,
} from '../../domain/m3ObservationSheet.ts'

export type NextObservationLine = {
  side: M3ObservationSide
  ingredientId: string
} | null

function assertNextObservationTarget(
  value: unknown,
): asserts value is Exclude<NextObservationLine, null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid next observation target')
  }

  const target = value as Record<string, unknown>
  if (
    (target.side !== 'baseline' && target.side !== 'candidate') ||
    typeof target.ingredientId !== 'string' ||
    !target.ingredientId.trim()
  ) {
    throw new Error('Invalid next observation target')
  }
}

export function nextObservationActionLabel(
  sheet: ObservationSheet,
  next: NextObservationLine,
): string {
  if (next === null) return 'Alle regels zijn gemeten'
  assertNextObservationTarget(next)

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
