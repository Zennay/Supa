import type { PlannedMeal } from './types.ts'
import type { RecipeWithIngredients } from './basket.ts'
import {
  buildIngredientReuseInsight,
  type ReusedIngredient,
} from './ingredientReuse.ts'

export type ReuseTransition = {
  ingredientId: string
  label: string
  beforeSharedMealCount: number | null
  afterSharedMealCount: number | null
  beforeDays: string[]
  afterDays: string[]
}

export type RecipeReusePreview = {
  day: string
  previousRecipeId: string
  nextRecipeId: string
  beforeSharedCount: number
  afterSharedCount: number
  newlyShared: ReuseTransition[]
  noLongerShared: ReuseTransition[]
  changedShared: ReuseTransition[]
}

/**
 * Preview qualitative ingredient overlap before choosing a different recipe.
 *
 * The caller must compute this from current plan state on every relevant edit,
 * never from a persisted preview. It does not modify the plan and deliberately
 * contains no pack, leftover, price or savings estimate.
 */
export function previewRecipeReuseChange({
  plan,
  recipes,
  activeDays,
  day,
  recipeId,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  day: string
  recipeId: string
}): RecipeReusePreview | null {
  if (
    !Array.isArray(plan) ||
    !Array.isArray(recipes) ||
    !Array.isArray(activeDays) ||
    typeof day !== 'string' ||
    !day.trim() ||
    typeof recipeId !== 'string' ||
    !recipeId.trim() ||
    !activeDays.includes(day)
  ) {
    return null
  }

  const existingMeals = plan.filter((meal) => meal?.day === day)
  const selectedRecipes = recipes.filter((recipe) => recipe?.id === recipeId)
  if (existingMeals.length !== 1 || selectedRecipes.length !== 1) return null

  const before = buildIngredientReuseInsight({ plan, recipes, activeDays })
  if (!before) return null

  const proposedPlan = plan.map((meal) =>
    meal.day === day ? { ...meal, recipeId } : meal,
  )
  const after = buildIngredientReuseInsight({
    plan: proposedPlan,
    recipes,
    activeDays,
  })
  if (!after) return null

  const beforeById = new Map(before.reusedIngredients.map((row) => [row.ingredientId, row]))
  const afterById = new Map(after.reusedIngredients.map((row) => [row.ingredientId, row]))
  const ids = new Set([...beforeById.keys(), ...afterById.keys()])
  const newlyShared: ReuseTransition[] = []
  const noLongerShared: ReuseTransition[] = []
  const changedShared: ReuseTransition[] = []

  for (const ingredientId of ids) {
    const oldUsage: ReusedIngredient | undefined = beforeById.get(ingredientId)
    const newUsage: ReusedIngredient | undefined = afterById.get(ingredientId)
    const transition: ReuseTransition = {
      ingredientId,
      label: newUsage?.label ?? oldUsage!.label,
      beforeSharedMealCount: oldUsage?.mealCount ?? null,
      afterSharedMealCount: newUsage?.mealCount ?? null,
      beforeDays: oldUsage ? [...oldUsage.days] : [],
      afterDays: newUsage ? [...newUsage.days] : [],
    }

    if (!oldUsage && newUsage) {
      newlyShared.push(transition)
    } else if (oldUsage && !newUsage) {
      noLongerShared.push(transition)
    } else if (
      oldUsage &&
      newUsage &&
      (
        oldUsage.mealCount !== newUsage.mealCount ||
        oldUsage.days.some((activeDay, index) => activeDay !== newUsage.days[index])
      )
    ) {
      changedShared.push(transition)
    }
  }

  const byId = (a: ReuseTransition, b: ReuseTransition) =>
    a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0
  newlyShared.sort(byId)
  noLongerShared.sort(byId)
  changedShared.sort(byId)

  return {
    day,
    previousRecipeId: existingMeals[0].recipeId,
    nextRecipeId: recipeId,
    beforeSharedCount: before.reusedIngredients.length,
    afterSharedCount: after.reusedIngredients.length,
    newlyShared,
    noLongerShared,
    changedShared,
  }
}
