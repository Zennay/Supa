import { exportPrivatePlannerWeek } from '../comparison/exportPrivatePlannerWeek.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { ownRecipeShoppingChecklist } from './recipeShoppingChecklist.ts'
import { scaledMetricPortionAmount } from '../../domain/metricPortionScale.ts'
import type { SavedRecipe } from './recipeLibrary.ts'

/**
 * Export 1–14 independently selected, locally owned recipes into the EXISTING
 * private basket demand importer. Recipe data is unpriced. No assumed retailer
 * authorisation, product matching, observation time or promotion is attached.
 */
export function exportCombinedRecipesPrivateWeek(
  recipes: readonly SavedRecipe[], portionsById: Readonly<Record<string, number>> = {},
): string {
  if (!Array.isArray(recipes) || !recipes.length || recipes.length > 14 ||
      new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) {
    throw new Error('Kies 1 tot 14 unieke eigen recepten om het mandje te vergelijken.')
  }
  const converted = recipes.map(recipe => {
    const portions = Object.hasOwn(portionsById, recipe.id)
      ? portionsById[recipe.id] : recipe.servings
    if (typeof portions !== 'number' || !Number.isSafeInteger(portions) ||
        portions < 1 || portions > 100 ||
        typeof recipe.servings !== 'number' || !Number.isSafeInteger(recipe.servings) ||
        recipe.servings < 1 || recipe.servings > 1000) {
      throw new Error('Controleer de originele en gewenste hele porties van ' + recipe.title + ' (1–100 per mandje).')
    }
    const shopping = ownRecipeShoppingChecklist(recipe, portions)
    const recipeForBasket = toPlannerRecipe(recipe, { usage: 'unpriced-demand' })
    if (!shopping.canCopy || shopping.lines.some(line => line.needsReview) || !recipeForBasket) {
      throw new Error('Corrigeer eerst de onzekere hoeveelheden of gedeeltelijke stuks in ' + recipe.title + '.')
    }
    const ingredients = recipeForBasket.ingredients.map(ingredient => {
      if (!['g', 'ml', 'piece'].includes(ingredient.unit) ||
          typeof ingredient.amount !== 'number')
        throw new Error('Niet-metrische ingrediënten in ' + recipe.title + '.')
      const amount = scaledMetricPortionAmount(ingredient.amount, recipe.servings!,
        portions, ingredient.unit as 'g' | 'ml' | 'piece')
      if (amount === null || amount > 100_000)
        throw new Error('Controleer de gewenste porties of eenheid van ' + recipe.title + '.')
      return { ...ingredient, amount }
    })
    // exportPrivatePlannerWeek independently checks IDs, quantities and
    // selected physical week demand; never invent retailer data.
    return { ...recipeForBasket, servings: portions, ingredients }
  })
  const days = converted.map((_, index) => 'Eigen recept ' + (index + 1))
  return exportPrivatePlannerWeek(
    converted.map((recipe, index) => ({ day: days[index], recipeId: recipe.id })),
    converted, days,
  )
}
