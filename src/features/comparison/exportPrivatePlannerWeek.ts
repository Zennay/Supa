import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { hasEveryOwnArrayIndex } from '../../domain/denseArray.ts'
import type { PlannedMeal } from '../../domain/types.ts'

/**
 * Portable, deliberately unpriced snapshot of only the active Supa week.
 * Compatible with privatePlannerDemandImport.ts on /private-basket-mapping.html.
 * No retailer identifiers, timestamps, prices or inferred observations.
 */
const MAX_BYTES = 256_000
const UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const textField = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  value === value.trim() && /[\p{L}\p{N}]/u.test(value) &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && !/^[=+@-]/u.test(value)

export function exportPrivatePlannerWeek(
  plan: readonly PlannedMeal[],
  recipes: readonly RecipeWithIngredients[],
  activeDays: readonly string[],
): string {
  if (!Array.isArray(plan) || !hasEveryOwnArrayIndex(plan) ||
    !Array.isArray(recipes) || !hasEveryOwnArrayIndex(recipes) ||
    !Array.isArray(activeDays) || !hasEveryOwnArrayIndex(activeDays) ||
    activeDays.length < 1 || activeDays.length > 14 ||
    new Set(activeDays).size !== activeDays.length ||
    !activeDays.every(day => textField(day, 40))) {
    throw new Error('Kies eerst een geldig weekmenu met unieke dagen.')
  }

  const selected = plan.filter(meal => activeDays.includes(meal.day))
  if (selected.length !== activeDays.length ||
    selected.length > 14 || new Set(selected.map(meal => meal.day)).size !== activeDays.length ||
    !selected.every(meal => textField(meal.day, 40) && textField(meal.recipeId, 100))) {
    throw new Error('Niet iedere geselecteerde dag heeft precies één maaltijd.')
  }

  const requiredIds = new Set(selected.map(meal => meal.recipeId))
  const selectedRecipes = recipes.filter(recipe => requiredIds.has(recipe.id))
  if (selectedRecipes.length !== requiredIds.size ||
    new Set(selectedRecipes.map(recipe => recipe.id)).size !== selectedRecipes.length) {
    throw new Error('De geselecteerde recepten zijn niet eenduidig beschikbaar.')
  }
  const minimalRecipes = selectedRecipes.map(recipe => {
    if (!textField(recipe.id, 100) || !Array.isArray(recipe.ingredients) ||
      !hasEveryOwnArrayIndex(recipe.ingredients) ||
      recipe.ingredients.length > 1000) {
      throw new Error('Een geselecteerd recept heeft ongeldige gegevens.')
    }
    const ingredients = recipe.ingredients.map((ingredient: RecipeWithIngredients['ingredients'][number]) => {
      if (!textField(ingredient.id, 100) || !textField(ingredient.label) ||
        !textField(ingredient.query) || !UNITS.has(ingredient.unit) ||
        (ingredient.amount !== null && (
          typeof ingredient.amount !== 'number' || !Number.isFinite(ingredient.amount) ||
          ingredient.amount <= 0 || ingredient.amount > 100_000 ||
          (ingredient.unit === 'piece' && !Number.isInteger(ingredient.amount))
        ))) {
        throw new Error('Controleer de namen en metrische hoeveelheden van je recepten.')
      }
      return {
        id: ingredient.id,
        label: ingredient.label,
        query: ingredient.query,
        amount: ingredient.amount,
        unit: ingredient.unit,
      }
    })
    return { id: recipe.id, ingredients }
  })

  // Confirm that the exported source produces exactly the current canonical
  // physical demand. Reject malformed or inconsistent cross-recipe identities.
  const demand = aggregatePlanIngredients(selected, selectedRecipes, [...activeDays])
  if (demand.length < 1 || demand.length > 200 ||
    demand.some(item => !textField(item.id, 100) || !textField(item.label) ||
      !UNITS.has(item.unit) ||
      (item.amount !== null && (
        !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100_000 ||
        (item.unit === 'piece' && !Number.isInteger(item.amount))
      )))) {
    throw new Error('Dit weekmenu heeft geen veilig overdraagbare fysieke ingrediënten.')
  }
  const payload = {
    schema: 'supa-private-planner-week-v1',
    plan: selected.map(meal => ({ day: meal.day, recipeId: meal.recipeId })),
    activeDays: [...activeDays],
    recipes: minimalRecipes,
  }
  const json = JSON.stringify(payload, null, 2) + '\n'
  if (new TextEncoder().encode(json).byteLength > MAX_BYTES) {
    throw new Error('Het geselecteerde weekmenu is te groot (maximaal 256 kB).')
  }
  return json
}
