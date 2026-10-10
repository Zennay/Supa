import { buildOneStoreBasket, type OneStoreBasket, type RecipeWithIngredients } from '../domain/basket.ts'
import { compareFullBaskets, type BasketComparisonOutcome } from '../domain/basketComparison.ts'
import type { PlannedMeal } from '../domain/types.ts'
import {
  projectFreshControlledComparisonCatalogs,
  type ControlledComparisonInputs,
} from './trustedMultipackComparisonCatalog.ts'

/**
 * Opt-in, source-only two-store comparison feasibility check.
 *
 * Every projected product must come from its corresponding controlled source
 * observations: there is deliberately NO fallback to M2 demo fixtures.
 * Structural success is NOT M3 field evidence, retailer reuse permission,
 * or a permission to publish a savings claim.
 */
export type ControlledSourceBasketInputs = ControlledComparisonInputs & {
  baselineStoreName: string
  candidateStoreName: string
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}

export type ControlledSourceBasketReadiness =
  | {
      status: 'structural-fail'
      releaseEligible: false
      reason: 'source-or-plan-not-comparable'
      comparison: null
    }
  | {
      status: 'structural-pass'
      releaseEligible: false
      captureWindowHours: number
      baseline: OneStoreBasket
      candidate: OneStoreBasket
      /** Structural test-only arithmetic, NEVER a user savings claim. */
      outcome: Exclude<BasketComparisonOutcome, 'unknown'>
      candidateMinusBaselineCents: number
    }

const FAILURE: ControlledSourceBasketReadiness = Object.freeze({
  status: 'structural-fail',
  releaseEligible: false,
  reason: 'source-or-plan-not-comparable',
  comparison: null,
})

export function assessControlledSourceBasketReadiness(
  input: ControlledSourceBasketInputs | null,
): ControlledSourceBasketReadiness {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return FAILURE
    if (
      typeof input.baselineStoreName !== 'string' ||
      !input.baselineStoreName.trim() ||
      typeof input.candidateStoreName !== 'string' ||
      !input.candidateStoreName.trim() ||
      !Array.isArray(input.plan) ||
      !Array.isArray(input.recipes) ||
      !Array.isArray(input.activeDays) ||
      input.activeDays.length === 0
    ) return FAILURE

    const catalogs = projectFreshControlledComparisonCatalogs(input)
    if (!catalogs) return FAILURE

    const common = {
      plan: input.plan,
      recipes: input.recipes,
      activeDays: input.activeDays,
    }
    const baseline = buildOneStoreBasket({
      ...common,
      store: { id: input.baselineStore.id, name: input.baselineStoreName },
      products: catalogs.baseline,
    })
    const candidate = buildOneStoreBasket({
      ...common,
      store: { id: input.candidateStore.id, name: input.candidateStoreName },
      products: catalogs.candidate,
    })

    // Comparing two empty weeks would produce a fabricated 'same' outcome.
    // Every selected demand must match a trustworthy product on BOTH sides.
    if (
      baseline.selectedMealCount === 0 ||
      candidate.selectedMealCount === 0 ||
      baseline.lines.length === 0 ||
      baseline.lines.length !== candidate.lines.length ||
      baseline.unresolvedLineCount !== 0 ||
      candidate.unresolvedLineCount !== 0
    ) return FAILURE

    const comparison = compareFullBaskets({ baseline, candidate })
    if (
      !comparison.claimable ||
      comparison.outcome === 'unknown' ||
      comparison.deltaCents === null ||
      !Number.isSafeInteger(comparison.deltaCents)
    ) return FAILURE

    return {
      status: 'structural-pass',
      releaseEligible: false,
      captureWindowHours: catalogs.captureWindowHours,
      baseline,
      candidate,
      outcome: comparison.outcome,
      candidateMinusBaselineCents: comparison.deltaCents as number,
    }
  } catch {
    // Fail closed at the JSON/runtime boundary without echoing source,
    // participant keys or exception contents into diagnostics.
    return FAILURE
  }
}
