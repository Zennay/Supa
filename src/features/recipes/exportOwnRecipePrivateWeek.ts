import { exportPrivatePlannerWeek } from '../comparison/exportPrivatePlannerWeek.ts'
import type { SavedRecipe } from './recipeLibrary.ts'
import { toPlannerRecipe } from './plannerRecipes.ts'
import { ownRecipeShoppingChecklist } from './recipeShoppingChecklist.ts'
import { scaledMetricPortionAmount } from '../../domain/metricPortionScale.ts'

/** Real, user-reviewed physical recipe demand only. No retailer identity,
 * SKU, price, observation or source authorization is generated. */
export function exportOwnRecipePrivateWeek(recipe: SavedRecipe, portions: number): string {
  const checklist = ownRecipeShoppingChecklist(recipe, portions)
  if (!checklist.canCopy || checklist.lines.some(line => line.needsReview)) {
    throw new Error('Corrigeer eerst onzekere hoeveelheden en gedeeltelijke stuks.')
  }
  // An unpriced physical demand does not require a cooking duration.
  // It shares the strict ingredient, metric, whole-piece and warning gates,
  // but no invented cooking time is added to the source recipe.
  const plannerRecipe = toPlannerRecipe(recipe, { usage: 'unpriced-demand' })
  if (!plannerRecipe || typeof recipe.servings !== 'number' || recipe.servings <= 0) {
    throw new Error('Dit recept mist volledig bevestigde metrische ingrediënten.')
  }
  const ingredients = plannerRecipe.ingredients.map(ingredient => {
    if (ingredient.amount === null || !Number.isFinite(ingredient.amount)) {
      throw new Error('Een ingrediënt heeft geen bevestigde hoeveelheid.')
    }
    // Use the exact same source-portion arithmetic as the unpriced recipe
    // checklist and in-app Planner. No binary-float undercount at 0.001g/ml,
    // no rounding a physical fraction of an egg or other piece.
    if (!['g', 'ml', 'piece'].includes(ingredient.unit)) {
      throw new Error('Een ingrediënt gebruikt een onbekende metrische eenheid.')
    }
    const amount = scaledMetricPortionAmount(
      ingredient.amount, recipe.servings!, portions,
      ingredient.unit as 'g' | 'ml' | 'piece',
    )
    if (amount === null || amount > 100_000) {
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
