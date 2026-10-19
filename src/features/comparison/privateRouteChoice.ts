import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { createMixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'
import { freshReviewedBaskets } from './privateReviewedBasketBridge.ts'
import type { OwnStore, PrivateReviewedBaskets, PrivateRouteChoice } from './privateReviewedBasketBridge.ts'

/** Shared source-bound click contract for Products and Planner → mixed List.
 * No route is selected from demo prices, mismatched demands or stale receipts. */
export function currentPrivateRouteChoice(
  reviewed: PrivateReviewedBaskets | null,
  ingredientId: string,
  store: OwnStore,
  nowMs: number,
): Omit<PrivateRouteChoice, 'serial'> | null {
  const fresh = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', nowMs)
  const plus = fresh?.stores.PLUS
  const deka = fresh?.stores.DekaMarkt
  if (!plus || !deka ||
      Math.abs(plus.capturedMs - deka.capturedMs) > 86400000 ||
      !compareFullBaskets({ baseline: plus.basket, candidate: deka.basket }).claimable) return null
  const route = createMixedStoreShoppingPlan(
    plus.basket, deka.basket, 'mixed', { [ingredientId]: store })
  const line = route?.lines.find(value => value.id === ingredientId && value.store === store)
  if (!line) return null
  return {
    planKey: fresh!.planKey,
    observedAt: { PLUS: plus.observedAt, DekaMarkt: deka.observedAt },
    ingredientId, store, lineKey: line.key,
  }
}
