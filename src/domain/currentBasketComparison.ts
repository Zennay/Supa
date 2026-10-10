import { compareFullBaskets, type BasketComparison } from './basketComparison.ts'
import type { OneStoreBasket } from './basket.ts'

/**
 * Recompute a two-store comparison from the current baskets.
 *
 * Never accept a previously cached BasketComparison here: its line deltas do
 * not contain a demand/pack snapshot identifier and cannot prove freshness
 * after a planner edit. The canonical comparator remains the only source of
 * basket arithmetic and monetary claims.
 *
 * null means that no money difference should be presented. The caller can
 * still render the individual incomplete baskets or offer a correction step.
 */
export function compareCurrentBaskets(input: {
  baseline: OneStoreBasket
  candidate: OneStoreBasket
}): BasketComparison | null {
  if (!input || typeof input !== 'object') return null

  const { baseline, candidate } = input
  if (!baseline || !candidate) return null

  // The upstream comparator currently treats two empty baskets as 'same'.
  // No planned groceries means no meaningful monetary comparison (#1051).
  if (
    !Number.isSafeInteger(baseline.selectedMealCount) ||
    !Number.isSafeInteger(candidate.selectedMealCount) ||
    baseline.selectedMealCount <= 0 ||
    candidate.selectedMealCount <= 0 ||
    !Array.isArray(baseline.lines) ||
    !Array.isArray(candidate.lines) ||
    baseline.lines.length === 0 ||
    candidate.lines.length === 0
  ) {
    return null
  }

  try {
    // This canonical call checks matching ingredient demand, whole-pack
    // economics, prices, cent totals and line coverage at the *current* call.
    // Catch malformed runtime snapshots (e.g. absent nested pack metadata)
    // until the upstream comparator can represent them as unknown itself.
    const current = compareFullBaskets({ baseline, candidate })
    return current.claimable === true &&
      current.reasons.length === 0 &&
      current.lineDeltas.length > 0
      ? current
      : null
  } catch {
    return null
  }
}
