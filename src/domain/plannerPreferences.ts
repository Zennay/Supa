import type { PlannedMeal } from './types.ts'

export type PlannerPreferences = {
  budget: number
  activeDays: string[]
  recipeByDay: Record<string, string>
}

export function defaultPlannerPreferences(
  defaultPlan: PlannedMeal[],
  fallbackBudget = 35,
): PlannerPreferences {
  return {
    budget: fallbackBudget,
    activeDays: defaultPlan.map((meal) => meal.day),
    recipeByDay: Object.fromEntries(
      defaultPlan.map((meal) => [meal.day, meal.recipeId]),
    ),
  }
}

export function parsePlannerPreferences(
  raw: string | null,
  defaultPlan: PlannedMeal[],
  validRecipeIds: string[],
  fallbackBudget = 35,
): PlannerPreferences {
  const fallback = defaultPlannerPreferences(defaultPlan, fallbackBudget)
  if (!raw) return fallback

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback

    const candidate = parsed as {
      budget?: unknown
      activeDays?: unknown
      recipeByDay?: unknown
    }
    const validDays = new Set(defaultPlan.map((meal) => meal.day))
    const validRecipes = new Set(validRecipeIds)

    const budget =
      typeof candidate.budget === 'number' &&
      Number.isFinite(candidate.budget) &&
      candidate.budget > 0
        ? candidate.budget
        : fallbackBudget

    let activeDays = fallback.activeDays
    if (Array.isArray(candidate.activeDays)) {
      const filteredDays = Array.from(
        new Set(
          candidate.activeDays.filter(
            (day): day is string =>
              typeof day === 'string' && validDays.has(day),
          ),
        ),
      )

      activeDays =
        candidate.activeDays.length > 0 && filteredDays.length === 0
          ? fallback.activeDays
          : filteredDays
    }

    const persistedRecipes =
      candidate.recipeByDay &&
      typeof candidate.recipeByDay === 'object' &&
      !Array.isArray(candidate.recipeByDay)
        ? (candidate.recipeByDay as Record<string, unknown>)
        : {}

    const recipeByDay = Object.fromEntries(
      defaultPlan.map((meal) => {
        const persisted = persistedRecipes[meal.day]
        return [
          meal.day,
          typeof persisted === 'string' && validRecipes.has(persisted)
            ? persisted
            : meal.recipeId,
        ]
      }),
    )

    return { budget, activeDays, recipeByDay }
  } catch {
    return fallback
  }
}

export function serializePlannerPreferences(
  preferences: PlannerPreferences,
): string {
  return JSON.stringify(preferences)
}
