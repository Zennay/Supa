import type { PlannedMeal } from '../../domain/types.ts'
import { m2DefaultActiveDays, m2InitialPlan } from '../../data/m2Fixture.ts'

/**
 * The M3 measurement sheet is deliberately a frozen, four-meal research
 * fixture (11 required ingredients for *each* store), not the customer's
 * editable Planner demand. Never mistake a matching budget or a visually
 * similar recipe for matching physical requirements.
 *
 * This is a presentation-only mismatch check: it does not read saved drafts,
 * mutate preferences, or authorize a field-study claim.
 */
export function m3FieldSheetMatchesPlannerWeek(
  plannedMeals: unknown,
  activeDays: unknown,
): boolean {
  try {
    if (!Array.isArray(plannedMeals) || !Array.isArray(activeDays) ||
        plannedMeals.length !== m2InitialPlan.length ||
        activeDays.length !== m2DefaultActiveDays.length ||
        new Set(activeDays).size !== m2DefaultActiveDays.length ||
        !activeDays.every(day =>
          typeof day === 'string' && m2DefaultActiveDays.includes(day))) {
      return false
    }

    const recipesByDay = new Map<string, string>()
    for (const item of plannedMeals as PlannedMeal[]) {
      if (!item || typeof item.day !== 'string' ||
          typeof item.recipeId !== 'string' || recipesByDay.has(item.day)) {
        return false
      }
      recipesByDay.set(item.day, item.recipeId)
    }
    return m2InitialPlan.every(meal =>
      recipesByDay.get(meal.day) === meal.recipeId)
  } catch {
    // A corrupted planner must never be presented as the canonical study.
    return false
  }
}
