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
  next: unknown,
): string {
  if (next === null) return 'Alle regels zijn gemeten'

  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw new Error('invalid next observation target')
  }

  const candidate = next as Partial<Exclude<NextObservationLine, null>>
  if (
    (candidate.side !== 'baseline' && candidate.side !== 'candidate') ||
    typeof candidate.ingredientId !== 'string' ||
    candidate.ingredientId.trim() === ''
  ) {
    throw new Error('invalid next observation target')
  }

  const retailer = M3_EXPECTED_RETAILERS[candidate.side]
  const line = sheet[candidate.side].lines.find(
    (lineCandidate) => lineCandidate.ingredientId === candidate.ingredientId,
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
