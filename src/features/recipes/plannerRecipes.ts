import type { RecipeWithIngredients } from '../../domain/basket.ts'
import type { SavedRecipe } from './recipeLibrary.ts'

/**
 * An owned recipe may join the ordinary weekly Planner only when its entire
 * physical demand is safe to shop for. The unpriced recipe checklist and
 * standalone basket importer already require whole physical pieces; the normal
 * Planner must not silently bypass that rule through local recipe storage.
 *
 * Rejected recipes remain editable in Mijn recepten. Never round eggs or other
 * pieces up, invent a pack, or turn missing source measurements into a price.
 */
export function toPlannerRecipe(
  recipe: SavedRecipe,
  options: { usage?: 'planner' | 'unpriced-demand' } = {},
): RecipeWithIngredients | null {
  const unpricedOnly = options.usage === 'unpriced-demand'
  const durationValid = typeof recipe?.minutes === 'number' &&
    Number.isFinite(recipe.minutes) && recipe.minutes > 0 && recipe.minutes <= 1440
  if (!recipe || typeof recipe !== 'object' ||
      !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0 ||
      !Array.isArray(recipe.warnings) ||
      !recipe.warnings.every(warning => unpricedOnly
        ? warning === 'Bereidingstijd ontbreekt of is onduidelijk'
        : false) ||
      typeof recipe.servings !== 'number' || !Number.isFinite(recipe.servings) ||
      recipe.servings <= 0 || recipe.servings > 1000 ||
      (!unpricedOnly && !durationValid)) return null

  const ready = recipe.ingredients.every(ingredient => {
    if (!ingredient || ingredient.reviewReason !== null ||
        typeof ingredient.query !== 'string' || !ingredient.query.trim() ||
        typeof ingredient.label !== 'string' || !ingredient.label.trim() ||
        typeof ingredient.amount !== 'number' || !Number.isFinite(ingredient.amount) ||
        ingredient.amount <= 0 || ingredient.amount > 1_000_000 ||
        !['g', 'ml', 'piece'].includes(ingredient.unit ?? '')) return false
    return ingredient.unit !== 'piece' || Number.isSafeInteger(ingredient.amount)
  })
  if (!ready) return null

  return {
    id: recipe.id, title: recipe.title,
    // The private export removes minutes entirely. Never invent a duration.
    minutes: durationValid ? recipe.minutes : Number.NaN, servings: recipe.servings,
    estimatedCost: Number.NaN, tags: ['Eigen recept'],
    ingredients: recipe.ingredients.map(ingredient => ({
      id: `own-ingredient:${ingredient.query}:${ingredient.unit}`,
      label: ingredient.label, query: ingredient.query,
      amount: ingredient.amount, unit: ingredient.unit ?? 'unknown',
    })),
  }
}
