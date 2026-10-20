import { exportPrivatePlannerWeek } from '../comparison/exportPrivatePlannerWeek.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { ownRecipeShoppingChecklist } from './recipeShoppingChecklist.ts'
import type { SavedRecipe } from './recipeLibrary.ts'

/**
 * Export 1–14 independently selected, locally owned recipes into the EXISTING
 * private basket demand importer. Recipe data is unpriced. No assumed retailer
 * authorisation, product matching, observation time or promotion is attached.
 */
export function exportCombinedRecipesPrivateWeek(recipes: readonly SavedRecipe[]): string {
  if (!Array.isArray(recipes) || !recipes.length || recipes.length > 14 ||
      new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) {
    throw new Error('Kies 1 tot 14 unieke eigen recepten om het mandje te vergelijken.')
  }
  const converted = recipes.map(recipe => {
    if (typeof recipe.servings !== 'number' || !Number.isSafeInteger(recipe.servings) ||
        recipe.servings < 1 || recipe.servings > 100) {
      throw new Error('Controleer de originele porties van ' + recipe.title + ' (maximaal 100).')
    }
    const shopping = ownRecipeShoppingChecklist(recipe, recipe.servings)
    const recipeForBasket = toPlannerRecipe(recipe, { usage: 'unpriced-demand' })
    if (!shopping.canCopy || shopping.lines.some(line => line.needsReview) || !recipeForBasket) {
      throw new Error('Corrigeer eerst de onzekere hoeveelheden in ' + recipe.title + '.')
    }
    // exportPrivatePlannerWeek rechecks exact ingredient dimensions, ID and
    // total-demand consistency, with an independent 100,000-unit ceiling.
    return recipeForBasket
  })
  const days = converted.map((_, index) => 'Eigen recept ' + (index + 1))
  return exportPrivatePlannerWeek(
    converted.map((recipe, index) => ({ day: days[index], recipeId: recipe.id })),
    converted, days,
  )
}
