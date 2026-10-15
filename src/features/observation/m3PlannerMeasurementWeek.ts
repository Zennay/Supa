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
        activeDays.length !== m2DefaultActiveDays.length) {
      return false
    }

    // Array#every skips holes. Set iteration includes them as undefined and
    // can therefore still report four distinct entries for three real days
    // plus one missing slot. Read only own DATA descriptors: an inherited day
    // or an accessor must never mask a changed M3 measurement week.
    const selectedDays: string[] = []
    for (let index = 0; index < m2DefaultActiveDays.length; index++) {
      const slot = Object.getOwnPropertyDescriptor(activeDays, String(index))
      if (!slot || !Object.hasOwn(slot, 'value') ||
          typeof slot.value !== 'string' ||
          !m2DefaultActiveDays.includes(slot.value)) {
        return false
      }
      selectedDays.push(slot.value)
    }
    if (new Set(selectedDays).size !== m2DefaultActiveDays.length) {
      return false
    }

    // Planner meal records have the same trust boundary as selected days.
    // Ordinary property reads can invoke getters or inherited prototype values,
    // which can masquerade as a valid frozen study despite unstable input.
    // Explicit indexed data descriptors also reject holes/getters in the rows.
    const recipesByDay = new Map<string, string>()
    for (let index = 0; index < m2InitialPlan.length; index++) {
      const rowSlot = Object.getOwnPropertyDescriptor(plannedMeals, String(index))
      if (!rowSlot || !Object.hasOwn(rowSlot, 'value') ||
          !rowSlot.value || typeof rowSlot.value !== 'object') {
        return false
      }
      const day = Object.getOwnPropertyDescriptor(rowSlot.value, 'day')
      const recipeId = Object.getOwnPropertyDescriptor(rowSlot.value, 'recipeId')
      if (!day || !recipeId ||
          !Object.hasOwn(day, 'value') || !Object.hasOwn(recipeId, 'value') ||
          typeof day.value !== 'string' || typeof recipeId.value !== 'string' ||
          recipesByDay.has(day.value)) {
        return false
      }
      recipesByDay.set(day.value, recipeId.value)
    }
    return m2InitialPlan.every(meal =>
      recipesByDay.get(meal.day) === meal.recipeId)
  } catch {
    // A corrupted planner must never be presented as the canonical study.
    return false
  }
}
