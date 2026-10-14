import {
  buildOneStoreBasket,
  type OneStoreBasket,
  type RecipeWithIngredients,
  type StoreProduct,
} from './basket.ts'
import type { BasketComparison } from './basketComparison.ts'
import { compareCurrentBaskets } from './currentBasketComparison.ts'
import type { PlannedMeal, Store } from './types.ts'

/**
 * A single, current planner input for both stores. Unlike passing two
 * precomputed baskets, this makes it impossible to accidentally supply one
 * basket from an earlier active-week or recipe selection.
 *
 * Input prices/catalogs are caller-controlled. This does NOT validate their
 * freshness or source permission and must not be presented as live savings.
 */
export type CurrentPlannedComparisonInput = {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  baseline: { store: Store; products: StoreProduct[] }
  candidate: { store: Store; products: StoreProduct[] }
}

export type CurrentPlannedComparison = {
  baseline: OneStoreBasket
  candidate: OneStoreBasket
  comparison: BasketComparison | null
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Rebuild both baskets and recompare in one synchronous, deterministic pass.
 *
 * `null` result = malformed/unusable *input*; nothing may be claimed.
 * A non-null result with `comparison: null` preserves usable partial/empty
 * baskets for the planner UI while suppressing unproven financial differences.
 * Do not retain this return value after any planner, product, store or price
 * revision; call again with the latest input instead.
 */
export function compareCurrentPlannedBaskets(
  input: CurrentPlannedComparisonInput,
): CurrentPlannedComparison | null {
  if (!record(input)) return null
  const { plan, recipes, activeDays, baseline, candidate } = input

  if (
    !Array.isArray(plan) ||
    !Array.isArray(recipes) ||
    !Array.isArray(activeDays) ||
    activeDays.some(
      (day) => typeof day !== 'string' || day.trim().length === 0,
    ) ||
    new Set(activeDays).size !== activeDays.length ||
    !record(baseline) ||
    !record(candidate) ||
    !Array.isArray(baseline.products) ||
    !Array.isArray(candidate.products) ||
    !record(baseline.store) ||
    !record(candidate.store)
  ) {
    return null
  }

  try {
    const shared = { plan, recipes, activeDays }
    const baselineBasket = buildOneStoreBasket({
      ...shared,
      store: baseline.store,
      products: baseline.products,
    })
    const candidateBasket = buildOneStoreBasket({
      ...shared,
      store: candidate.store,
      products: candidate.products,
    })

    return {
      baseline: baselineBasket,
      candidate: candidateBasket,
      comparison: compareCurrentBaskets({
        baseline: baselineBasket,
        candidate: candidateBasket,
      }),
    }
  } catch {
    // E.g. an invalid restored plan, unknown recipe, or malformed input JSON.
    // Never expose an older price comparison on failure.
    return null
  }
}
