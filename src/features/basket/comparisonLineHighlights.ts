import { compareFullBaskets, type BasketComparison } from '../../domain/basketComparison.ts'
import type { OneStoreBasket } from '../../domain/basket.ts'
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
      !Number.isSafeInteger(comparison.baselineTotalCents) || comparison.baselineTotalCents <= 0 ||
      !Number.isSafeInteger(comparison.candidateTotalCents) || comparison.candidateTotalCents <= 0 ||
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
        !Number.isSafeInteger(line.baselineLineTotalCents) || line.baselineLineTotalCents <= 0 ||
        !Number.isSafeInteger(line.candidateLineTotalCents) || line.candidateLineTotalCents <= 0 ||
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

/**
 * A direct caller cannot forge a complete headline by passing a valid-looking
 * comparison that contradicts either of the actual physical baskets on screen.
 * Incomplete baskets, duplicate line IDs, extra/missing rows and changed prices
 * all abstain. This never accesses retailer data.
 */
export function comparisonMatchesVisibleBaskets(
  comparison: BasketComparison,
  baseline: OneStoreBasket,
  candidate: OneStoreBasket,
): boolean {
  if (!hasTrustedComparisonLineEvidence(comparison)) return false
  if (!baseline || !candidate ||
      typeof baseline.store?.id !== 'string' || !baseline.store.id.trim() ||
      typeof candidate.store?.id !== 'string' || !candidate.store.id.trim() ||
      baseline.store.id === candidate.store.id ||
      !Number.isSafeInteger(baseline.selectedMealCount) ||
      !Number.isSafeInteger(candidate.selectedMealCount) ||
      baseline.selectedMealCount <= 0 ||
      baseline.selectedMealCount !== candidate.selectedMealCount ||
      !Array.isArray(baseline.lines) || !Array.isArray(candidate.lines) ||
      baseline.unresolvedLineCount !== 0 || candidate.unresolvedLineCount !== 0 ||
      baseline.matchedLineCount !== baseline.lines.length ||
      candidate.matchedLineCount !== candidate.lines.length ||
      baseline.lines.length !== comparison.lineDeltas.length ||
      candidate.lines.length !== comparison.lineDeltas.length ||
      baseline.totalCents !== comparison.baselineTotalCents ||
      candidate.totalCents !== comparison.candidateTotalCents) return false

  const actual = (basket: OneStoreBasket, key: 'baselineLineTotalCents' | 'candidateLineTotalCents') => {
    const lines = new Map<string, { ingredientLabel: string; lineTotalCents: number }>()
    for (const line of basket.lines) {
      if (!line || line.status !== 'matched' ||
          typeof line.id !== 'string' || lines.has(line.id) ||
          !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents <= 0) return false
      lines.set(line.id, line)
    }
    if (lines.size !== comparison.lineDeltas.length) return false
    return comparison.lineDeltas.every((line) => {
      const physical = lines.get(line.id)
      return physical !== undefined && physical.ingredientLabel === line.ingredientLabel &&
        physical.lineTotalCents === line[key]
    })
  }
  if (!actual(baseline, 'baselineLineTotalCents') ||
      !actual(candidate, 'candidateLineTotalCents')) return false

  // Current row IDs, labels and cents are necessary, but not sufficient:
  // altered ingredients, pack sizes, pack counts and matching confidence can
  // change the physical basket while leaving all displayed cents identical.
  // Re-run the canonical physical comparison on the two *visible* baskets so
  // the headline never outlives its actual ingredient/pack arithmetic.
  try {
    const physicallyCurrent = compareFullBaskets({ baseline, candidate })
    if (!physicallyCurrent.claimable ||
        physicallyCurrent.outcome !== comparison.outcome ||
        physicallyCurrent.baselineTotalCents !== comparison.baselineTotalCents ||
        physicallyCurrent.candidateTotalCents !== comparison.candidateTotalCents ||
        physicallyCurrent.deltaCents !== comparison.deltaCents ||
        physicallyCurrent.savingsCents !== comparison.savingsCents ||
        physicallyCurrent.lineDeltas.length !== comparison.lineDeltas.length) return false

    const currentById = new Map(physicallyCurrent.lineDeltas.map(line => [line.id, line]))
    return currentById.size === comparison.lineDeltas.length &&
      comparison.lineDeltas.every(line => {
        const current = currentById.get(line.id)
        return current !== undefined &&
          current.ingredientLabel === line.ingredientLabel &&
          current.baselineLineTotalCents === line.baselineLineTotalCents &&
          current.candidateLineTotalCents === line.candidateLineTotalCents &&
          current.deltaCents === line.deltaCents
      })
  } catch {
    // Loaded malformed runtime state must never unlock a money claim.
    return false
  }
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
