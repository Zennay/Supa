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
  const formattedAmount = euro.formatCents(totalCents)

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
      amountLabel: euro.formatCents(Math.abs(line.deltaCents)),
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
      amountLabel: euro.formatCents(Math.abs(line.deltaCents)),
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
  reasons: string[],
): string {
  if (status === 'matched') {
    return 'Automatisch gekozen op basis van ingrediënt en verpakking.'
  }

  if (reasons.includes('top candidates too close')) {
    return 'Meerdere producten lijken even passend; kies zelf.'
  }

  if (reasons.includes('score below trust threshold')) {
    return 'Geen productmatch is zeker genoeg; kies zelf.'
  }

  if (reasons.includes('no candidates')) {
    return 'Geen passend product gevonden; kies zelf.'
  }

  if (reasons.includes('candidate unavailable')) {
    return 'Geen betrouwbaar beschikbaar product gevonden; kies zelf.'
  }

  if (
    reasons.some((reason) =>
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

  if (reasons.includes('matched product missing from store catalog')) {
    return 'De gekozen productinformatie ontbreekt; kies zelf.'
  }

  return 'SUPA kan hier niet betrouwbaar automatisch kiezen; kies zelf.'
}

/**
 * A price difference is user-facing only when the complete signed-cent
 * comparison is internally consistent. Never coerce missing runtime money
 * to zero or derive a comparison claim from a malformed snapshot.
 *
 * This is a presentation trust boundary, not evidence of live shop prices.
 */
export function basketComparisonHeadline(
  comparison: BasketComparison,
  candidate: { store: { name: string } },
): string {
  const abstain = 'Nog geen betrouwbare vergelijking'
  const storeName = candidate?.store?.name
  if (
    !comparison || typeof comparison !== 'object' ||
    comparison.claimable !== true ||
    !Array.isArray(comparison.reasons) ||
    comparison.reasons.length !== 0 ||
    typeof storeName !== 'string' ||
    storeName.trim().length === 0 ||
    storeName !== storeName.trim() ||
    !Number.isSafeInteger(comparison.baselineTotalCents) ||
    comparison.baselineTotalCents < 0 ||
    !Number.isSafeInteger(comparison.candidateTotalCents) ||
    comparison.candidateTotalCents < 0 ||
    !Number.isSafeInteger(comparison.deltaCents) ||
    !Number.isSafeInteger(comparison.savingsCents)
  ) {
    return abstain
  }

  const expectedDelta =
    comparison.candidateTotalCents - comparison.baselineTotalCents
  if (
    !Number.isSafeInteger(expectedDelta) ||
    comparison.deltaCents !== expectedDelta ||
    comparison.savingsCents !== -expectedDelta
  ) {
    return abstain
  }

  if (comparison.outcome === 'same') {
    return expectedDelta === 0 ? 'Beide testmanden zijn even duur' : abstain
  }
  if (
    (comparison.outcome !== 'better' || expectedDelta >= 0) &&
    (comparison.outcome !== 'worse' || expectedDelta <= 0)
  ) {
    return abstain
  }

  const amount = euro.formatCents(Math.abs(expectedDelta))
  if (amount === '—') return abstain
  return comparison.outcome === 'better'
    ? `${storeName} ligt ${amount} lager`
    : `${storeName} ligt ${amount} hoger`
}
