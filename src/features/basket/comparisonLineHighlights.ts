import type { BasketComparison } from '../../domain/basketComparison.ts'
import { euro } from '../../lib/money.ts'

export type ComparisonLineHighlight = {
  id: string
  ingredientLabel: string
  direction: 'lower' | 'higher'
  amountLabel: string
}

// The controlled fixture's breakdown describes WHERE a total differs.
// It cannot infer pack-size effects, offers, planning effects, or real prices.

/** A financial headline and its ingredient breakdown share this exact proof. */
export function hasTrustedComparisonLineEvidence(comparison: BasketComparison): boolean {
  if (!comparison || comparison.claimable !== true ||
      !['better', 'same', 'worse'].includes(comparison.outcome) ||
      !Array.isArray(comparison.reasons) || comparison.reasons.length !== 0 ||
      !Array.isArray(comparison.lineDeltas) || comparison.lineDeltas.length === 0 ||
      !Number.isSafeInteger(comparison.baselineTotalCents) || comparison.baselineTotalCents < 0 ||
      !Number.isSafeInteger(comparison.candidateTotalCents) || comparison.candidateTotalCents < 0 ||
      !Number.isSafeInteger(comparison.deltaCents) ||
      !Number.isSafeInteger(comparison.savingsCents)) return false

  const expected = comparison.candidateTotalCents - comparison.baselineTotalCents
  if (!Number.isSafeInteger(expected) ||
      comparison.deltaCents !== expected || comparison.savingsCents !== -expected ||
      comparison.outcome !== (expected < 0 ? 'better' : expected > 0 ? 'worse' : 'same')) return false

  const seen = new Set<string>()
  let sum = 0
  let baselineSum = 0
  let candidateSum = 0
  for (const line of comparison.lineDeltas) {
    if (!line || typeof line !== 'object' ||
        typeof line.id !== 'string' || !line.id.trim() || line.id.trim() !== line.id ||
        line.id.length > 128 || seen.has(line.id) ||
        typeof line.ingredientLabel !== 'string' ||
        line.ingredientLabel.length > 180 || line.ingredientLabel.trim() !== line.ingredientLabel ||
        !/[\p{L}\p{N}]/u.test(line.ingredientLabel) ||
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line.ingredientLabel) ||
        !Number.isSafeInteger(line.baselineLineTotalCents) || line.baselineLineTotalCents < 0 ||
        !Number.isSafeInteger(line.candidateLineTotalCents) || line.candidateLineTotalCents < 0 ||
        !Number.isSafeInteger(line.deltaCents) ||
        line.deltaCents !== line.candidateLineTotalCents - line.baselineLineTotalCents) return false
    seen.add(line.id)
    sum += line.deltaCents
    baselineSum += line.baselineLineTotalCents
    candidateSum += line.candidateLineTotalCents
    if (!Number.isSafeInteger(sum) || !Number.isSafeInteger(baselineSum) ||
        !Number.isSafeInteger(candidateSum)) return false
  }
  if (sum !== comparison.deltaCents || baselineSum !== comparison.baselineTotalCents ||
      candidateSum !== comparison.candidateTotalCents) return false
  return true
}

export function comparisonLineHighlights(
  comparison: BasketComparison,
  limit = 3,
): ComparisonLineHighlight[] {
  if (!hasTrustedComparisonLineEvidence(comparison)) return []
  const max = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 3) : 3
  return comparison.lineDeltas
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.deltaCents !== 0)
    .sort((a, b) => Math.abs(b.line.deltaCents) - Math.abs(a.line.deltaCents) || a.index - b.index)
    .slice(0, max)
    .map(({ line }) => ({
      id: line.id,
      ingredientLabel: line.ingredientLabel,
      direction: line.deltaCents < 0 ? 'lower' : 'higher',
      amountLabel: euro.formatCents(Math.abs(line.deltaCents)),
    }))
}

export function comparisonLineHighlightCopy(
  highlight: ComparisonLineHighlight,
  store: string,
): string {
  const storeName = typeof store === 'string' && store.trim()
    ? store.trim() : 'De kandidaatwinkel'
  return `${storeName} is op deze mandregel ${highlight.amountLabel} ${highlight.direction === 'lower' ? 'lager' : 'hoger'}.`
}
