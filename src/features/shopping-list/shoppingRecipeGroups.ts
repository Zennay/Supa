import type { BasketTraceLine, RecipeWithIngredients } from '../../domain/basket'
import type { PlannedMeal } from '../../domain/types'

export type ShoppingRecipeGroup<T extends { id: string } = BasketTraceLine> = {
  key: string
  title: string
  lines: T[]
}

/**
 * Layout-only grouping. Shared ingredients appear ONCE in the first selected
 * recipe that uses them. No basket calculations, checked IDs or export order
 * are changed; the original source basket remains authoritative.
 */
export function groupShoppingByRecipe<T extends { id: string }>(
  lines: readonly T[],
  plan?: readonly PlannedMeal[],
  recipes?: readonly RecipeWithIngredients[],
  activeDays?: readonly string[],
): ShoppingRecipeGroup<T>[] {
  if (!Array.isArray(lines)) return []
  if (!Array.isArray(plan) || !Array.isArray(recipes) || !Array.isArray(activeDays)) {
    return [{ key: 'all', title: 'Jouw boodschappen', lines: [...lines] }]
  }

  const active = new Set(activeDays)
  const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]))
  const recipeForIngredient = new Map<string, string>()
  const groups = new Map<string, ShoppingRecipeGroup<T>>()

  for (const meal of plan) {
    if (!active.has(meal.day)) continue
    const recipe = recipeById.get(meal.recipeId)
    if (!recipe) continue
    if (!groups.has(recipe.id)) {
      groups.set(recipe.id, {
        key: recipe.id,
        title: recipe.title.trim() || 'Recept',
        lines: [],
      })
    }
    for (const ingredient of recipe.ingredients) {
      if (!recipeForIngredient.has(ingredient.id)) {
        recipeForIngredient.set(ingredient.id, recipe.id)
      }
    }
  }

  for (const line of lines) {
    const key = recipeForIngredient.get(line.id) ?? '__other__'
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: key === '__other__' ? 'Overige boodschappen' : 'Jouw boodschappen',
        lines: [],
      })
    }
    groups.get(key)!.lines.push(line)
  }

  const visible = [...groups.values()].filter(group => group.lines.length > 0)
  return visible.length ? visible : [{ key: 'all', title: 'Jouw boodschappen', lines: [] }]
}
