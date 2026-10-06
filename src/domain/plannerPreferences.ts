import type { PlannedMeal } from './types.ts'

export const DEFAULT_PLANNER_BUDGET_OPTIONS = [30, 35, 40] as const

export type PlannerPreferences = {
  budget: number
  activeDays: string[]
  recipeByDay: Record<string, string>
}

function isCanonicalIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  )
}

function canonicalizeDefaultPlan(defaultPlan: unknown): PlannedMeal[] | null {
  if (!Array.isArray(defaultPlan)) return null

  const canonicalPlan: PlannedMeal[] = []
  const seenDays = new Set<string>()

  for (const entry of defaultPlan) {
    if (!entry || typeof entry !== 'object') return null

    const { day, recipeId } = entry as {
      day?: unknown
      recipeId?: unknown
    }

    if (
      !isCanonicalIdentity(day) ||
      !isCanonicalIdentity(recipeId) ||
      seenDays.has(day)
    ) {
      return null
    }

    seenDays.add(day)
    canonicalPlan.push({ day, recipeId })
  }

  return canonicalPlan
}

export function defaultPlannerPreferences(
  defaultPlan: PlannedMeal[],
  fallbackBudget = 35,
): PlannerPreferences {
  const safeFallbackBudget =
    Number.isFinite(fallbackBudget) && fallbackBudget > 0 ? fallbackBudget : 35

  const canonicalPlan = canonicalizeDefaultPlan(defaultPlan) ?? []

  return {
    budget: safeFallbackBudget,
    activeDays: canonicalPlan.map((meal) => meal.day),
    recipeByDay: Object.fromEntries(
      canonicalPlan.map((meal) => [meal.day, meal.recipeId]),
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
  const supportedBudgets = Array.from(
    new Set(
      validBudgets.filter(
        (budget) => Number.isFinite(budget) && budget > 0,
      ),
    ),
  )
  const safeFallbackBudget = supportedBudgets.includes(fallbackBudget)
    ? fallbackBudget
    : (supportedBudgets[0] ?? 35)
  const canonicalDefaultPlan = canonicalizeDefaultPlan(defaultPlan) ?? []
  const fallback = defaultPlannerPreferences(
    canonicalDefaultPlan,
    safeFallbackBudget,
  )
  if (!raw) return fallback

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback

    const candidate = parsed as {
      budget?: unknown
      activeDays?: unknown
      recipeByDay?: unknown
    }
    const canonicalDays = canonicalDefaultPlan.map((meal) => meal.day)
    const validDays = new Set(canonicalDays)
    const validRecipes = new Set(validRecipeIds)
    const supportedBudgetSet = new Set(supportedBudgets)

    const budget =
      typeof candidate.budget === 'number' &&
      supportedBudgetSet.has(candidate.budget)
        ? candidate.budget
        : safeFallbackBudget

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
      canonicalDefaultPlan.map((meal) => {
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
