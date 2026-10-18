import type { PlannedMeal } from '../../domain/types.ts'
import type { RecipeWithIngredients } from '../../domain/basket.ts'

/**
 * Manual choices made before second-store admission belong to one unchanged
 * original capture and the exact current Planner demand. No price or consent
 * claims are inferred by this private in-memory key.
 */
export function stagedStoreFingerprint(
  originalCapture: Record<string, unknown>,
  plan: PlannedMeal[],
  recipes: RecipeWithIngredients[],
  activeDays: string[],
): string {
  return JSON.stringify([
    originalCapture, plan, activeDays,
    recipes.map(recipe => [recipe.id, recipe.ingredients]),
  ])
}
