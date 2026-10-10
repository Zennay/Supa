import { compareFullBaskets, type BasketComparison } from './basketComparison.ts'
import type { OneStoreBasket } from './basket.ts'

/**
 * JSON and persisted snapshots can carry a string pack.amount that the
 * canonical comparator currently coerces via multiplication. Its *value*
 * may be mathematically equivalent, but it is not a valid typed basket pack.
 * Do not present a monetary claim from type-coerced metadata.
 */
function strictMatchedPackMetadata(lines: unknown[]): boolean {
  return lines.every((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false
    if (!('status' in line) || line.status !== 'matched') return true

    const pack = line.pack
    return (
      pack !== null &&
      typeof pack === 'object' &&
      !Array.isArray(pack) &&
      typeof pack.amount === 'number' &&
      Number.isFinite(pack.amount) &&
      pack.amount > 0
    )
  })
}

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
    candidate.lines.length === 0 ||
    !strictMatchedPackMetadata(baseline.lines) ||
    !strictMatchedPackMetadata(candidate.lines)
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
