import {
  M3_EXPECTED_RETAILERS,
  nextIncompleteObservationLine,
  observationLineCollectionComplete,
  type M3ObservationSide,
  type ObservationSheet,
} from '../../domain/m3ObservationSheet.ts'

export type NextObservationLine = {
  side: M3ObservationSide
  ingredientId: string
} | null

function observationLinesForSide(
  sheet: unknown,
  side: M3ObservationSide,
): unknown[] {
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    throw new Error('invalid observation sheet')
  }

  const observation = (sheet as Partial<Record<M3ObservationSide, unknown>>)[side]
  if (
    !observation ||
    typeof observation !== 'object' ||
    Array.isArray(observation)
  ) {
    throw new Error('invalid observation sheet')
  }

  const lines = (observation as { lines?: unknown }).lines
  if (!Array.isArray(lines)) {
    throw new Error('invalid observation sheet')
  }

  return lines
}

export function nextObservationActionLabel(
  sheet: unknown,
  next: unknown,
): string {
  const baselineLines = observationLinesForSide(sheet, 'baseline')
  const candidateLines = observationLinesForSide(sheet, 'candidate')

  if (next === null) {
    let pending: ReturnType<typeof nextIncompleteObservationLine>
    try {
      pending = nextIncompleteObservationLine(sheet as ObservationSheet)
    } catch {
      throw new Error('invalid observation sheet')
    }

    if (pending !== null) {
      throw new Error('observation sheet is not complete')
    }

    return 'Alle regels zijn gemeten'
  }

  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw new Error('invalid next observation target')
  }

  const candidate = next as Partial<Exclude<NextObservationLine, null>>
  if (
    (candidate.side !== 'baseline' && candidate.side !== 'candidate') ||
    typeof candidate.ingredientId !== 'string' ||
    candidate.ingredientId.trim() === '' ||
    candidate.ingredientId !== candidate.ingredientId.trim()
  ) {
    throw new Error('invalid next observation target')
  }

  const retailer = M3_EXPECTED_RETAILERS[candidate.side]
  const lines =
    candidate.side === 'baseline' ? baselineLines : candidateLines
  let matchingLineExists = false
  let matchingIncompleteLineCount = 0
  let ingredientLabel = ''

  for (const lineCandidate of lines) {
    if (
      !lineCandidate ||
      typeof lineCandidate !== 'object' ||
      Array.isArray(lineCandidate) ||
      (lineCandidate as { ingredientId?: unknown }).ingredientId !==
        candidate.ingredientId
    ) {
      continue
    }

    matchingLineExists = true

    let lineIncomplete = false
    try {
      lineIncomplete = !observationLineCollectionComplete(
        lineCandidate as ObservationSheet['baseline']['lines'][number],
      )
    } catch {
      continue
    }

    if (!lineIncomplete) {
      continue
    }

    matchingIncompleteLineCount += 1
    if (matchingIncompleteLineCount > 1) {
      throw new Error('invalid next observation target')
    }

    const label = (lineCandidate as { ingredientLabel?: unknown }).ingredientLabel
    if (typeof label === 'string' && label.trim() !== '') {
      ingredientLabel = label.trim()
    }
  }

  if (!matchingLineExists || matchingIncompleteLineCount !== 1) {
    throw new Error('invalid next observation target')
  }

  return ingredientLabel
    ? `Volgende: ${retailer} · ${ingredientLabel}`
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
