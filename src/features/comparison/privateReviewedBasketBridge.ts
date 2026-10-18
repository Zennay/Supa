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

export function freshReviewedBaskets(
  snapshots: PrivateReviewedBaskets | null,
  expectedPlanKey: string,
  nowMs: number,
): PrivateReviewedBaskets | null {
  if (!snapshots || snapshots.planKey !== expectedPlanKey) return null
  const entries = Object.entries(snapshots.stores).filter(([, value]) =>
    value && Number.isFinite(value.capturedMs) &&
    nowMs >= value.capturedMs - 300000 &&
    nowMs - value.capturedMs <= 7 * 86400000 &&
    value.basket.lines.length > 0 && value.basket.unresolvedLineCount === 0 &&
    value.basket.matchedLineCount === value.basket.lines.length)
  if (!entries.length) return null
  return { planKey: snapshots.planKey,
    stores: Object.fromEntries(entries) as PrivateReviewedBaskets['stores'] }
}
