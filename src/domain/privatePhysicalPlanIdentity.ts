import type { PlannedMeal } from './types.ts'
import type { RecipeWithIngredients } from './basket.ts'

/**
 * Fingerprint only the PHYSICAL demand currently selected by the user.
 *
 * The old App fingerprint included every recipe in the library. Importing
 * an unrelated recipe or changing an inactive day revoked perfectly current,
 * user-reviewed PLUS/Deka captures, shopping ticks and personal extras.
 *
 * Keep identity tied to the canonical active-day order, the selected recipe
 * identity and all actual ingredient fields used for physical matching.
 * Missing/duplicated recipes remain explicit UNKNOWN inputs and must never
 * alias a valid previously reviewed basket.
 */
export function privatePhysicalPlanIdentity(
  plan: readonly PlannedMeal[],
  recipes: readonly RecipeWithIngredients[],
  activeDays: readonly string[],
): string {
  const wanted = new Set(activeDays)
  const chosen = plan.filter(meal => wanted.has(meal.day)).map(meal => {
    const matching = recipes.filter(recipe => recipe.id === meal.recipeId)
    const ingredients = matching.length === 1
      ? matching[0].ingredients.map(item => [
          item.id, item.label, item.query, item.amount, item.unit,
        ])
      : null
    return [meal.day, meal.recipeId, ingredients]
  })
  return JSON.stringify(['supa-selected-physical-week-v1', chosen])
}

/**
 * Unlike monetary basket identity, a copy of the week menu also displays
 * recipe titles and (optionally) minutes/portions. A prepared share must not
 * survive editing that visible text in another tab.
 */
export function privateWeekShareIdentity(
  plan: readonly PlannedMeal[],
  recipes: readonly RecipeWithIngredients[],
  activeDays: readonly string[],
  includeDetails: boolean,
): string {
  const wanted = new Set(activeDays)
  const chosen = plan.filter(meal => wanted.has(meal.day)).map(meal => {
    const matching = recipes.filter(recipe => recipe.id === meal.recipeId)
    const recipe = matching.length === 1 ? matching[0] : null
    return [meal.day, meal.recipeId, recipe?.title ?? null,
      includeDetails ? recipe?.minutes ?? null : null,
      includeDetails ? recipe?.servings ?? null : null]
  })
  return JSON.stringify(['supa-selected-week-share-v1', chosen])
}
