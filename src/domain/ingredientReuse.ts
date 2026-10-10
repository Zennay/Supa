import { aggregatePlanIngredients, type RecipeWithIngredients } from './basket.ts'
import type { PlannedMeal } from './types.ts'

/**
 * An ingredient appearing in more than one active planned meal.
 *
 * This describes meal overlap, not the amount left over, packs saved, or
 * verified monetary savings. Store/pricing evidence is deliberately absent.
 */
export type ReusedIngredient = {
  ingredientId: string
  label: string
  days: string[]
  recipeIds: string[]
  mealCount: number
}

export type IngredientReuseInsight = {
  activeMealCount: number
  distinctIngredientCount: number
  reusedIngredients: ReusedIngredient[]
}

/**
 * Explain which *current, active* meals share an ingredient.
 *
 * No persistence, basket price estimation, implicit recipe substitutions or
 * side effects. Null means the active plan is untrustworthy (or is empty).
 * Existing canonical plan aggregation remains the authority for consistent
 * ingredient definitions.
 */
export function buildIngredientReuseInsight({
  plan,
  recipes,
  activeDays,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}): IngredientReuseInsight | null {
  if (!Array.isArray(plan) || !Array.isArray(recipes) || !Array.isArray(activeDays)) {
    return null
  }
  if (
    activeDays.length === 0 ||
    activeDays.some((day) => typeof day !== 'string' || !day.trim()) ||
    new Set(activeDays).size !== activeDays.length
  ) {
    return null
  }

  let canonicalIngredients: ReturnType<typeof aggregatePlanIngredients>
  try {
    canonicalIngredients = aggregatePlanIngredients(plan, recipes, activeDays)
  } catch {
    return null
  }

  // Never report a confident overlap for unknown quantities or malformed
  // ingredient definitions. A shared id alone is not trustworthy evidence.
  if (
    canonicalIngredients.some(
      (ingredient) =>
        typeof ingredient.amount !== 'number' ||
        !Number.isFinite(ingredient.amount) ||
        ingredient.amount <= 0 ||
        typeof ingredient.label !== 'string' ||
        !ingredient.label.trim(),
    )
  ) {
    return null
  }

  const byIngredient = new Map<string, { days: string[]; recipeIds: string[] }>()
  for (const day of activeDays) {
    const meals = plan.filter((meal) => meal?.day === day)
    if (meals.length !== 1) return null
    const matchingRecipes = recipes.filter((recipe) => recipe?.id === meals[0].recipeId)
    if (matchingRecipes.length !== 1 || !Array.isArray(matchingRecipes[0].ingredients)) {
      return null
    }

    const seenOnDay = new Set<string>()
    for (const ingredient of matchingRecipes[0].ingredients) {
      if (!ingredient || typeof ingredient.id !== 'string') return null
      if (seenOnDay.has(ingredient.id)) continue
      seenOnDay.add(ingredient.id)

      const existing = byIngredient.get(ingredient.id)
      if (existing) {
        existing.days.push(day)
        existing.recipeIds.push(meals[0].recipeId)
      } else {
        byIngredient.set(ingredient.id, {
          days: [day],
          recipeIds: [meals[0].recipeId],
        })
      }
    }
  }

  // Guard against invalid/malformed nested inputs that can sneak past
  // generic JavaScript call boundaries despite TypeScript annotations.
  if (byIngredient.size !== canonicalIngredients.length) return null

  const reusedIngredients = canonicalIngredients.flatMap((ingredient) => {
    const usage = byIngredient.get(ingredient.id)
    if (!usage || usage.days.length < 2) return []
    return [{
      ingredientId: ingredient.id,
      label: ingredient.label,
      days: [...usage.days],
      recipeIds: [...usage.recipeIds],
      mealCount: usage.days.length,
    }]
  })
  reusedIngredients.sort((a, b) =>
    b.mealCount - a.mealCount ||
    (a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0),
  )

  return {
    activeMealCount: activeDays.length,
    distinctIngredientCount: canonicalIngredients.length,
    reusedIngredients,
  }
}
