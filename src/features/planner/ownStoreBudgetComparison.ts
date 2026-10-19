import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { createMixedStoreShoppingPlan } from '../comparison/mixedStoreShoppingPlan.ts'
import type { PrivateReviewedBaskets, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'

export type ComparedOwnLine = {
  id: string
  ingredientLabel: string
  plus: Extract<BasketTraceLine, { status: 'matched' }>
  deka: Extract<BasketTraceLine, { status: 'matched' }>
  deltaCents: number
}

export type OwnStoreWeekComparison =
  | { status: 'missing'; available: OwnStore[] }
  | { status: 'different-moments'; available: OwnStore[] }
  | { status: 'not-comparable'; available: OwnStore[] }
  | { status: 'comparable'; available: ['PLUS', 'DekaMarkt'];
      plusCents: number; dekaCents: number; differenceCents: number;
      cheapest: OwnStore | null; lines: ComparedOwnLine[];
      mixedRoute: { totalCents: number; possibleProductDifferenceCents: number;
        requiresTwoStops: boolean } | null }

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
  // The canonical comparison has already checked every physical requirement,
  // pack count, price and cent total. Show original source lines, never
  // reconstruct quantities or financial deltas in the presentation layer.
  const plusById = new Map(plus.basket.lines.filter((line): line is ComparedOwnLine['plus'] =>
    line.status === 'matched').map(line => [line.id, line]))
  const dekaById = new Map(deka.basket.lines.filter((line): line is ComparedOwnLine['deka'] =>
    line.status === 'matched').map(line => [line.id, line]))
  const lines: ComparedOwnLine[] = result.lineDeltas.map(delta => ({
    id: delta.id,
    ingredientLabel: delta.ingredientLabel,
    plus: plusById.get(delta.id)!, deka: dekaById.get(delta.id)!,
    deltaCents: delta.deltaCents,
  }))
  lines.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents) ||
    a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl'))
  // Reuse the existing full physical mixed-store engine. This is a product-only
  // preview: net trip economics still require explicit user's visit costs in Vergelijk.
  const route = createMixedStoreShoppingPlan(plus.basket, deka.basket)
  const mixedRoute = route ? {
    totalCents: route.totalCents,
    possibleProductDifferenceCents: route.additionalDifferenceCents,
    requiresTwoStops: route.lines.some(line => line.store === 'PLUS') &&
      route.lines.some(line => line.store === 'DekaMarkt'),
  } : null
  return {
    status: 'comparable', available: ['PLUS', 'DekaMarkt'],
    plusCents: plus.basket.totalCents, dekaCents: deka.basket.totalCents,
    lines, mixedRoute,
    differenceCents: Math.abs(result.deltaCents),
    cheapest: result.deltaCents === 0 ? null : result.deltaCents > 0 ? 'PLUS' : 'DekaMarkt',
  }
}
