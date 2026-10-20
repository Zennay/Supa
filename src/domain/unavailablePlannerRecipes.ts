import type { PlannedMeal } from './types.ts'
import type { PlannerPreferences } from './plannerPreferences.ts'

export type UnavailablePlannerRecipe = Readonly<{
  day: string
  previousRecipeId: string
  fallbackRecipeId: string
}>

/**
 * Device-owned recipes can disappear or become unplannable while a Planner tab
 * is open (storage events, backup import, edited quantities or permission
 * changes). Keep the visible week physically evaluable without silently
 * rewriting another tab's persisted selection.
 *
 * Only the already bundled default recipe for that SAME day can be used as
 * a temporary preview fallback. Callers must require an explicit user click
 * before saving a replacement with the existing compare-and-swap guard.
 */
export function unavailablePlannerRecipes(
  preferences: PlannerPreferences,
  originalPlan: readonly PlannedMeal[],
  availableRecipeIds: readonly string[],
): UnavailablePlannerRecipe[] {
  if (!preferences || !preferences.recipeByDay ||
      typeof preferences.recipeByDay !== 'object' ||
      !Array.isArray(originalPlan) || !Array.isArray(availableRecipeIds)) return []
  const valid = new Set(availableRecipeIds)
  return originalPlan.flatMap(meal => {
    const chosen = preferences.recipeByDay[meal.day] ?? meal.recipeId
    return typeof chosen === 'string' && !valid.has(chosen) &&
      valid.has(meal.recipeId)
      ? [{ day: meal.day, previousRecipeId: chosen, fallbackRecipeId: meal.recipeId }]
      : []
  })
}

/** Returns a new display-only plan; original preferences and source stay intact. */
export function previewAvailablePlannerMeals(
  plan: readonly PlannedMeal[],
  unresolved: readonly UnavailablePlannerRecipe[],
  recipeByDay: Readonly<Record<string, string>>,
): PlannedMeal[] {
  const fallback = new Map(unresolved.map(item => [item.day, item.fallbackRecipeId]))
  return plan.map(meal => ({
    day: meal.day,
    recipeId: fallback.get(meal.day) ?? recipeByDay[meal.day] ?? meal.recipeId,
  }))
}
