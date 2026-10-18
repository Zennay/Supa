import { exportPrivatePlannerWeek } from '../comparison/exportPrivatePlannerWeek.ts'
import type { SavedRecipe } from './recipeLibrary.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { ownRecipeShoppingChecklist } from './recipeShoppingChecklist.ts'

/** Real, user-reviewed physical recipe demand only. No retailer identity,
 * SKU, price, observation or source authorization is generated. */
export function exportOwnRecipePrivateWeek(recipe: SavedRecipe, portions: number): string {
  const checklist = ownRecipeShoppingChecklist(recipe, portions)
  if (!checklist.canCopy || checklist.lines.some(line => line.needsReview)) {
    throw new Error('Corrigeer eerst onzekere hoeveelheden en gedeeltelijke stuks.')
  }
  // Cooking duration is optional for a physical shopping list and never
  // appears in the exported demand. Only the own ingredient facts matter.
  const plannerRecipe = toPlannerRecipe({
    ...recipe,
    minutes: recipe.minutes ?? 0,
  })
  if (!plannerRecipe || typeof recipe.servings !== 'number' || recipe.servings <= 0) {
    throw new Error('Dit recept mist volledig bevestigde metrische ingrediënten.')
  }
  const ingredients = plannerRecipe.ingredients.map(ingredient => {
    if (ingredient.amount === null || !Number.isFinite(ingredient.amount)) {
      throw new Error('Een ingrediënt heeft geen bevestigde hoeveelheid.')
    }
    const amount = Math.round(ingredient.amount * portions / recipe.servings! * 1000) / 1000
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000 ||
        (ingredient.unit === 'piece' && !Number.isSafeInteger(amount))) {
      throw new Error('Controleer de porties: deze hoeveelheid kan niet worden overgedragen.')
    }
    return { ...ingredient, amount }
  })
  const day = 'Eigen recept'
  return exportPrivatePlannerWeek(
    [{ day, recipeId: plannerRecipe.id }],
    [{ ...plannerRecipe, servings: portions, ingredients }],
    [day],
  )
}
