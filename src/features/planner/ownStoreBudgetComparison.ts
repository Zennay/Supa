import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { PrivateReviewedBaskets, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'

export type OwnStoreWeekComparison =
  | { status: 'missing'; available: OwnStore[] }
  | { status: 'different-moments'; available: OwnStore[] }
  | { status: 'not-comparable'; available: OwnStore[] }
  | { status: 'comparable'; available: ['PLUS', 'DekaMarkt'];
      plusCents: number; dekaCents: number; differenceCents: number;
      cheapest: OwnStore | null }

/**
 * Only human-reviewed, plan-bound in-memory baskets reach this adapter.
 * Reuse the canonical exact physical-demand and whole-pack calculator;
 * never infer a price from historical, demo or one-sided source data.
 */
export function ownStoreWeekComparison(reviewed: PrivateReviewedBaskets | null): OwnStoreWeekComparison {
  const plus = reviewed?.stores.PLUS
  const deka = reviewed?.stores.DekaMarkt
  const available = (['PLUS', 'DekaMarkt'] as const).filter(store => !!reviewed?.stores[store])
  if (!plus || !deka) return { status: 'missing', available }
  if (!Number.isFinite(plus.capturedMs) || !Number.isFinite(deka.capturedMs) ||
      Math.abs(plus.capturedMs - deka.capturedMs) > 86_400_000) {
    return { status: 'different-moments', available }
  }
  const result = compareFullBaskets({ baseline: plus.basket, candidate: deka.basket })
  if (!result.claimable || result.deltaCents === null ||
      !Number.isSafeInteger(result.deltaCents) ||
      !Number.isSafeInteger(plus.basket.totalCents) ||
      !Number.isSafeInteger(deka.basket.totalCents)) {
    return { status: 'not-comparable', available }
  }
  return {
    status: 'comparable', available: ['PLUS', 'DekaMarkt'],
    plusCents: plus.basket.totalCents, dekaCents: deka.basket.totalCents,
    differenceCents: Math.abs(result.deltaCents),
    cheapest: result.deltaCents === 0 ? null : result.deltaCents > 0 ? 'PLUS' : 'DekaMarkt',
  }
}
