import type { PlannedMeal } from './types.ts'

export const DEFAULT_PLANNER_BUDGET_OPTIONS = [30, 35, 40] as const

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
  validBudgets: readonly number[] = DEFAULT_PLANNER_BUDGET_OPTIONS,
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
    const canonicalDays = Array.from(new Set(defaultPlan.map((meal) => meal.day)))
    const validDays = new Set(canonicalDays)
    const validRecipes = new Set(validRecipeIds)
    const supportedBudgets = new Set(
      validBudgets.filter(
        (budget) => Number.isFinite(budget) && budget > 0,
      ),
    )

    const budget =
      typeof candidate.budget === 'number' &&
      supportedBudgets.has(candidate.budget)
        ? candidate.budget
        : fallbackBudget

    let activeDays = fallback.activeDays
    if (Array.isArray(candidate.activeDays)) {
      const persistedDays = new Set(
        candidate.activeDays.filter(
          (day): day is string =>
            typeof day === 'string' && validDays.has(day),
        ),
      )
      const orderedDays = canonicalDays.filter((day) =>
        persistedDays.has(day),
      )

      activeDays =
        candidate.activeDays.length > 0 && orderedDays.length === 0
          ? fallback.activeDays
          : orderedDays
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
