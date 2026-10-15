import { aggregatePlanIngredients, type RecipeWithIngredients } from './basket.ts'
import type { PlannedMeal } from './types.ts'
import {
  buildReviewedCatalogPlannerQueue,
  type ReviewedPlannerQueue,
} from './reviewedCatalogPlannerQueue.ts'

export type DynamicReviewedWeek = {
  mode: 'dynamic-week-private-review-only'
  activeDayCount: number
  selectedMealCount: number
  uniqueIngredientNeeds: number
  retailerReviewRows: number
  preview: ReviewedPlannerQueue
  livePriceClaimsAllowed: false
}

/**
 * A real user-chosen meal plan can reuse one store-independent matching engine.
 * The existing aggregation contract combines e.g. Ma+Do chicken, rice and
 * cauliflower amounts *before* any retailer candidate is considered.
 *
 * This returns only historical, private, human-review proposals. It must
 * never create a priced basket, actual observation or savings percentage.
 */
export function buildDynamicReviewedWeek({
  catalog,
  plan,
  recipes,
  activeDays,
}: {
  catalog: unknown
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}): DynamicReviewedWeek {
  if (!Array.isArray(activeDays) || activeDays.length < 1 ||
      activeDays.length > 7 || new Set(activeDays).size !== activeDays.length ||
      activeDays.some(day => typeof day !== 'string' || day.trim() !== day ||
        !/^[A-Za-zÀ-ž]{2,16}$/u.test(day))) {
    throw new Error('Selected week days must be unique canonical day labels')
  }
  if (!Array.isArray(plan) || !Array.isArray(recipes) ||
      plan.length > 14 || recipes.length > 100) {
    throw new Error('Dynamic planner input is not bounded')
  }
  // No defaulting null quantities, no widening known demand when a recipe
  // differs: aggregatePlanIngredients already rejects definition drift.
  const ingredients = aggregatePlanIngredients(plan, recipes, activeDays)
  if (ingredients.length === 0 || ingredients.length > 100 ||
      ingredients.some(item => item.amount === null ||
        !Number.isFinite(item.amount) || item.amount <= 0)) {
    throw new Error('Dynamic planner cannot review missing or unknown ingredient demand')
  }
  const preview = buildReviewedCatalogPlannerQueue(catalog, ingredients)
  return {
    mode: 'dynamic-week-private-review-only',
    activeDayCount: activeDays.length,
    selectedMealCount: activeDays.length,
    uniqueIngredientNeeds: ingredients.length,
    retailerReviewRows: preview.rows.length,
    preview,
    livePriceClaimsAllowed: false,
  }
}
