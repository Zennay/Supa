import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { BasketLineDelta } from '../../domain/basketComparison.ts'
import type { BasketComparison } from '../../domain/basketComparison.ts'
import { euro } from '../../lib/money.ts'

export type BasketCostDisclosure = {
  state: 'complete' | 'minimum' | 'unknown'
  headline: 'Deterministisch mandtotaal' | 'Bekend mandminimum' | 'Mandtotaal niet beschikbaar'
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
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return {
      state: 'unknown',
      headline: 'Mandtotaal niet beschikbaar',
      amountLabel: '—',
      unresolvedLineCount: safeUnresolvedLineCount,
    }
  }

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
 * The displayed basket panels are separate props from the comparison report.
 * Rebuild the canonical report from those *current* snapshots before trusting
 * a stale-but-self-consistent report from an earlier planner selection.
 */
function matchesCurrentDisplayedBaskets(
  comparison: BasketComparison,
  candidate: { store: { name: string } },
  baseline: OneStoreBasket,
): boolean {
  if (
    !baseline || typeof baseline !== 'object' ||
    !Array.isArray(baseline.lines) ||
    !Array.isArray((candidate as OneStoreBasket).lines)
  ) return false

  try {
    const actual = compareFullBaskets({
      baseline,
      candidate: candidate as OneStoreBasket,
    })
    if (
      !actual.claimable || actual.reasons.length !== 0 ||
      actual.outcome !== comparison.outcome ||
      actual.baselineTotalCents !== comparison.baselineTotalCents ||
      actual.candidateTotalCents !== comparison.candidateTotalCents ||
      actual.deltaCents !== comparison.deltaCents ||
      actual.savingsCents !== comparison.savingsCents ||
      actual.lineDeltas.length !== comparison.lineDeltas.length
    ) return false

    const actualById = new Map(actual.lineDeltas.map((line) => [line.id, line]))
    return comparison.lineDeltas.every((line) => {
      const current = actualById.get(line.id)
      return current !== undefined &&
        current.ingredientLabel === line.ingredientLabel &&
        current.baselineLineTotalCents === line.baselineLineTotalCents &&
        current.candidateLineTotalCents === line.candidateLineTotalCents &&
        current.deltaCents === line.deltaCents
    })
  } catch {
    // Malformed transient UI snapshots may not become financial evidence.
    return false
  }
}

/**
 * A price difference is user-facing only when the complete signed-cent
 * comparison is internally consistent. Never coerce missing runtime money
 * to zero or derive a comparison claim from a malformed snapshot.
 *
 * This is a presentation trust boundary, not evidence of live shop prices.
 */
export function basketComparisonCanShowMoney(
  comparison: BasketComparison,
  candidate: { store: { name: string } },
  displayedBaseline?: OneStoreBasket,
): boolean {
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
    return false
  }

  const expectedDelta =
    comparison.candidateTotalCents - comparison.baselineTotalCents
  if (
    !Number.isSafeInteger(expectedDelta) ||
    comparison.deltaCents !== expectedDelta ||
    comparison.savingsCents !== -expectedDelta
  ) {
    return false
  }

  // A basket-level headline is financial evidence only when its individual
  // rows also reconcile. In particular, a forged or stale lineDeltas array
  // must never yield a convincing price headline or rule-level breakdown.
  if (!Array.isArray(comparison.lineDeltas)) return false

  const seenLineIds = new Set<string>()
  let summedBaselineCents = 0
  let summedCandidateCents = 0
  let summedDeltaCents = 0

  for (const line of comparison.lineDeltas) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false
    if (
      typeof line.id !== 'string' ||
      line.id.length === 0 ||
      line.id !== line.id.trim() ||
      typeof line.ingredientLabel !== 'string' ||
      line.ingredientLabel.trim().length === 0 ||
      line.ingredientLabel !== line.ingredientLabel.trim() ||
      seenLineIds.has(line.id) ||
      !Number.isSafeInteger(line.baselineLineTotalCents) ||
      line.baselineLineTotalCents < 0 ||
      !Number.isSafeInteger(line.candidateLineTotalCents) ||
      line.candidateLineTotalCents < 0 ||
      !Number.isSafeInteger(line.deltaCents)
    ) return false

    seenLineIds.add(line.id)
    const lineDelta = line.candidateLineTotalCents - line.baselineLineTotalCents
    if (!Number.isSafeInteger(lineDelta) || lineDelta !== line.deltaCents) {
      return false
    }

    summedBaselineCents += line.baselineLineTotalCents
    summedCandidateCents += line.candidateLineTotalCents
    summedDeltaCents += lineDelta
    if (
      !Number.isSafeInteger(summedBaselineCents) ||
      !Number.isSafeInteger(summedCandidateCents) ||
      !Number.isSafeInteger(summedDeltaCents)
    ) return false
  }

  if (
    summedBaselineCents !== comparison.baselineTotalCents ||
    summedCandidateCents !== comparison.candidateTotalCents ||
    summedDeltaCents !== expectedDelta
  ) return false

  if (displayedBaseline && !matchesCurrentDisplayedBaskets(comparison, candidate, displayedBaseline)) return false

  if (comparison.outcome === 'same') return expectedDelta === 0
  if (comparison.outcome === 'better') return expectedDelta < 0
  if (comparison.outcome === 'worse') return expectedDelta > 0
  return false
}

export function basketComparisonHeadline(
  comparison: BasketComparison,
  candidate: { store: { name: string } },
  displayedBaseline?: OneStoreBasket,
): string {
  if (!basketComparisonCanShowMoney(comparison, candidate, displayedBaseline)) {
    return 'Nog geen betrouwbare vergelijking'
  }

  if (comparison.outcome === 'same') {
    return 'Beide testmanden zijn even duur'
  }

  const difference = euro.formatCents(
    Math.abs(comparison.candidateTotalCents - comparison.baselineTotalCents),
  )
  if (difference === '—') return 'Nog geen betrouwbare vergelijking'

  return comparison.outcome === 'better'
    ? `${candidate.store.name} ligt ${difference} lager`
    : `${candidate.store.name} ligt ${difference} hoger`
}
