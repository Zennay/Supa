import type { BasketTraceLine } from '../../domain/basket.ts'
import type { BasketLineDelta } from '../../domain/basketComparison.ts'
import type { BasketComparison } from '../../domain/basketComparison.ts'
import { euro } from '../../lib/money.ts'

export type BasketCostDisclosure = {
  state: 'complete' | 'minimum'
  headline: 'Deterministisch mandtotaal' | 'Bekend mandminimum'
  amountLabel: string
  unresolvedLineCount: number
}

export function basketCostDisclosure(
  totalCents: number,
  unresolvedLineCount: number,
): BasketCostDisclosure {
  const complete =
    Number.isInteger(unresolvedLineCount) && unresolvedLineCount === 0
  const safeUnresolvedLineCount =
    Number.isInteger(unresolvedLineCount) && unresolvedLineCount > 0
      ? unresolvedLineCount
      : complete
        ? 0
        : 1
  const formattedAmount = euro.format(totalCents / 100)

  return complete
    ? {
        state: 'complete',
        headline: 'Deterministisch mandtotaal',
        amountLabel: formattedAmount,
        unresolvedLineCount: 0,
      }
    : {
        state: 'minimum',
        headline: 'Bekend mandminimum',
        amountLabel: `min. ${formattedAmount}`,
        unresolvedLineCount: safeUnresolvedLineCount,
      }
}

export function basketReviewSummary(unresolvedLineCount: number): string | null {
  if (unresolvedLineCount === 0) return null

  if (Number.isInteger(unresolvedLineCount) && unresolvedLineCount > 0) {
    return unresolvedLineCount === 1
      ? '1 productkeuze vraagt jouw controle. Die staat bovenaan.'
      : `${unresolvedLineCount} productkeuzes vragen jouw controle. Die staan bovenaan.`
  }

  return 'Er zijn productkeuzes die jouw controle vragen. Die staan bovenaan.'
}

export function orderBasketLinesForReview(
  lines: readonly BasketTraceLine[],
): BasketTraceLine[] {
  const unresolved: BasketTraceLine[] = []
  const matched: BasketTraceLine[] = []

  for (const line of lines) {
    if (line.status === 'unresolved') {
      unresolved.push(line)
    } else {
      matched.push(line)
    }
  }

  return [...unresolved, ...matched]
}

export type ComparisonLineHighlight = {
  id: string
  ingredientLabel: string
  direction: 'lower' | 'higher'
  amountLabel: string
}

export function comparisonLineHighlights(
  comparison: BasketComparison,
  limit = 3,
): ComparisonLineHighlight[] {
  if (!comparison.claimable || comparison.outcome === 'unknown') return []

  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 3

  return comparison.lineDeltas
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line }) =>
        Number.isSafeInteger(line.deltaCents) && line.deltaCents !== 0,
    )
    .sort(
      (left, right) =>
        Math.abs(right.line.deltaCents) - Math.abs(left.line.deltaCents) ||
        left.index - right.index,
    )
    .slice(0, safeLimit)
    .map(({ line }) => ({
      id: line.id,
      ingredientLabel: line.ingredientLabel,
      direction: line.deltaCents < 0 ? 'lower' : 'higher',
      amountLabel: euro.format(Math.abs(line.deltaCents) / 100),
    }))
}

export function comparisonLineHighlightCopy(
  highlight: ComparisonLineHighlight,
  candidateStoreName: string,
): string {
  const storeName =
    typeof candidateStoreName === 'string' && candidateStoreName.trim()
      ? candidateStoreName.trim()
      : 'De kandidaatwinkel'

  return `${storeName} is op deze mandregel ${highlight.amountLabel} ${
    highlight.direction === 'lower' ? 'lager' : 'hoger'
  }.`
}

export type ComparisonLineBreakdown = {
  id: string
  ingredientLabel: string
  direction: 'lower' | 'higher'
  amountLabel: string
}

export function comparisonLineBreakdown(
  lineDeltas: readonly BasketLineDelta[],
  limit = 3,
): ComparisonLineBreakdown[] {
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? limit : 3

  return [...lineDeltas]
    .filter(
      (line) =>
        Number.isSafeInteger(line.deltaCents) && line.deltaCents !== 0,
    )
    .sort(
      (left, right) =>
        Math.abs(right.deltaCents) - Math.abs(left.deltaCents),
    )
    .slice(0, safeLimit)
    .map((line) => ({
      id: line.id,
      ingredientLabel: line.ingredientLabel,
      direction: line.deltaCents < 0 ? 'lower' : 'higher',
      amountLabel: euro.format(Math.abs(line.deltaCents) / 100),
    }))
}

export function comparisonWarningCopy(
  baselineUnresolvedLineCount: number,
  candidateUnresolvedLineCount: number,
  reasonCount: number,
): string {
  const baselineOpen =
    Number.isInteger(baselineUnresolvedLineCount) &&
    baselineUnresolvedLineCount > 0
      ? baselineUnresolvedLineCount
      : 0
  const candidateOpen =
    Number.isInteger(candidateUnresolvedLineCount) &&
    candidateUnresolvedLineCount > 0
      ? candidateUnresolvedLineCount
      : 0
  const openProductChoices = baselineOpen + candidateOpen

  if (openProductChoices > 0) {
    return `${openProductChoices} ${
      openProductChoices === 1 ? 'productkeuze moet' : 'productkeuzes moeten'
    } nog worden opgelost voordat SUPA een prijsverschil betrouwbaar kan tonen.`
  }

  if (Number.isInteger(reasonCount) && reasonCount > 0) {
    return 'Deze manden voldoen nog niet aan dezelfde betrouwbare vergelijkingsbasis.'
  }

  return 'SUPA kan voor deze manden nog geen betrouwbaar prijsverschil tonen.'
}

export function basketLineExplanation(
  status: 'matched' | 'unresolved',
  reasons: unknown,
): string {
  if (status === 'matched') {
    return 'Automatisch gekozen op basis van ingrediënt en verpakking.'
  }

  const safeReasons =
    Array.isArray(reasons) && reasons.every((reason) => typeof reason === 'string')
      ? reasons
      : []

  if (safeReasons.includes('top candidates too close')) {
    return 'Meerdere producten lijken even passend; kies zelf.'
  }

  if (safeReasons.includes('score below trust threshold')) {
    return 'Geen productmatch is zeker genoeg; kies zelf.'
  }

  if (safeReasons.includes('no candidates')) {
    return 'Geen passend product gevonden; kies zelf.'
  }

  if (safeReasons.includes('candidate unavailable')) {
    return 'Geen betrouwbaar beschikbaar product gevonden; kies zelf.'
  }

  if (
    safeReasons.some((reason) =>
      [
        'amount',
        'quantity',
        'unit family mismatch',
        'pack',
      ].some((marker) => reason.includes(marker)),
    )
  ) {
    return 'Hoeveelheid of verpakking is niet betrouwbaar genoeg; kies zelf.'
  }

  if (safeReasons.includes('matched product missing from store catalog')) {
    return 'De gekozen productinformatie ontbreekt; kies zelf.'
  }

  return 'SUPA kan hier niet betrouwbaar automatisch kiezen; kies zelf.'
}
