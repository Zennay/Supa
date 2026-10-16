import type { RecipeWithIngredients } from '../../domain/basket.ts'
import type { SavedRecipe } from './recipeLibrary.ts'

/** Same canonical recipe shape as built-ins, with no invented cost estimate. */
export function toPlannerRecipe(recipe: SavedRecipe): RecipeWithIngredients | null {
  if (recipe.servings === null || recipe.minutes === null || recipe.ingredients.some(i => i.reviewReason || i.amount === null || i.unit === null)) return null
  return {
    id: recipe.id, title: recipe.title, minutes: recipe.minutes, servings: recipe.servings,
    estimatedCost: Number.NaN, tags: ['Eigen recept'],
    ingredients: recipe.ingredients.map(i => ({
      id: `own-ingredient:${i.query}:${i.unit}`, label: i.label, query: i.query,
      amount: i.amount, unit: i.unit ?? 'unknown',
    })),
  }
}
