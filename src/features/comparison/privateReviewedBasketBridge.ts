import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import { isCoherentPricedBasket } from '../../domain/basketComparison.ts'
import type { OneStoreBasket } from '../../domain/basket.ts'

/** Transient, human-reviewed own-source baskets. No storage, no retailer rights. */
export type OwnStore = 'PLUS' | 'DekaMarkt'
export type PrivateReviewedBasket = {
  basket: OneStoreBasket
  observedAt: string
  capturedMs: number
}
export type PrivateReviewedBaskets = {
  planKey: string
  stores: Partial<Record<OwnStore, PrivateReviewedBasket>>
}

/** Compare the exact canonical UTC instants originally admitted from local
 * source JSON. Millisecond timestamps can erase a +1 ns violation of the
 * strict 24-hour pairing rule. Never infer or extend retailer permission.
 */
export function privateReviewedPairWithin24Hours(
  first: PrivateReviewedBasket, second: PrivateReviewedBasket,
): boolean {
  const left = observedInstant(first.observedAt)
  const right = observedInstant(second.observedAt)
  if (!left || !right || left.ms !== first.capturedMs ||
      right.ms !== second.capturedMs) return false
  const elapsed = left.ns >= right.ns ? left.ns - right.ns : right.ns - left.ns
  return elapsed <= 86_400_000_000_000n
}

/** In-memory progress for incomplete private shopping data. Never represents
 * a priced, reviewed basket and must never become a savings authority. */
export type PrivateCaptureProgress = {
  planKey: string
  stores: Partial<Record<OwnStore, {
    observedAt: string
    originalProductCount: number
    pricedProductCount: number
    nextIngredientId: string | null
    demandLineCount: number
    matchedLineCount: number
    reviewedLineCount: number
    autoMatchedLineCount: number
    missingIngredients: { id: string; label: string }[]
    awaitingReviewIngredients: { id: string; label: string }[]
    fresh: boolean
  }>>
}

export type PrivateReviewFocus = {
  planKey: string
  store: OwnStore
  ingredientId: string
  serial: number
}

/** Canonical original-source clock admission shared by UI status and exports.
 * No rounded millisecond difference may make an expired receipt appear usable.
 * Incomplete/invalid dates are unknown, never fresh by default. */
export function recentOwnCaptureInstant(observedAt: string, nowMs: number): boolean {
  if (!Number.isSafeInteger(nowMs)) return false
  const instant = observedInstant(observedAt)
  if (!instant) return false
  const ageNs = BigInt(nowMs) * 1_000_000n - instant.ns
  return ageNs >= -300_000_000_000n && ageNs <= 604_800_000_000_000n
}

export function freshReviewedBaskets(
  snapshots: PrivateReviewedBaskets | null,
  expectedPlanKey: string,
  nowMs: number,
): PrivateReviewedBaskets | null {
  if (!snapshots || snapshots.planKey !== expectedPlanKey ||
      !Number.isSafeInteger(nowMs)) return null
  const entries = Object.entries(snapshots.stores).filter(([store, value]) => {
    if ((store !== 'PLUS' && store !== 'DekaMarkt') || !value ||
        !Number.isSafeInteger(value.capturedMs) ||
        !isCoherentPricedBasket(value.basket, store)) return false
    // Keep full nanoseconds exactly as the original private import already
    // admitted them. Never display a stale source for a further fraction of
    // a millisecond, and never ignore a changed capturedMs envelope.
    const instant = observedInstant(value.observedAt)
    if (!instant || instant.ms !== value.capturedMs ||
        !recentOwnCaptureInstant(value.observedAt, nowMs)) return false
    // Counts alone are insufficient to admit a store as priced: the shared
    // basket contract above also checks SKU pack arithmetic, exact total cents,
    // required quantities, duplicate rows and retailer identity.
    return true
  })
  if (!entries.length) return null
  return { planKey: snapshots.planKey,
    stores: Object.fromEntries(entries) as PrivateReviewedBaskets['stores'] }
}


/** Ephemeral Products -> List intent for one exact already-reviewed SKU.
 * Carries no source rights, pricing authority, or reviewer approval.
 */
export type PrivateRouteChoice = {
  serial: number
  planKey: string
  observedAt: { PLUS: string; DekaMarkt: string }
  ingredientId: string
  store: OwnStore
  lineKey: string
}
