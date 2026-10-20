import type { PlannerPreferences } from '../../domain/plannerPreferences.ts'
import type { UnavailablePlannerRecipe } from '../../domain/unavailablePlannerRecipes.ts'
import { serializePlannerPreferences } from '../../domain/plannerPreferences.ts'
import { validCustomWeekBudgetEuros } from './customWeekBudget.ts'
import { canReplacePlannerRecord, persistPlannerRecord, type PlannerStorageWrite } from './plannerStorageGuard.ts'

type StorageBoundary = {
  read: () => string | null
  write: (raw: string) => void
}

/**
 * Explicit recovery for an otherwise valid v2 Planner record whose OWN recipe
 * IDs became unavailable. Ordinary persistence MUST still protect such data.
 * No future schema, foreign fields, corrupted day/budget, unsupported numeric
 * values or concurrent tab edits can be overwritten through this opt-in path.
 */
export function saveReplacedPlannerRecipes({
  read, write, expectedRaw, current, replacements, validDays, validRecipeIds,
}: StorageBoundary & {
  expectedRaw: string | null
  current: PlannerPreferences
  replacements: readonly UnavailablePlannerRecipe[]
  validDays: readonly string[]
  validRecipeIds: readonly string[]
}): PlannerStorageWrite {
  const nextRaw = serializePlannerPreferences(current)
  if (!replacements.length || !canReplacePlannerRecord(nextRaw, validDays, validRecipeIds)) {
    return { status: 'protected', raw: expectedRaw }
  }

  let actual: string | null
  try { actual = read() }
  catch { return { status: 'unavailable', raw: expectedRaw } }
  if (actual !== expectedRaw) return { status: 'protected', raw: actual }
  if (canReplacePlannerRecord(actual, validDays, validRecipeIds)) {
    return persistPlannerRecord({
      read, write, expectedRaw, nextRaw, validDays, validRecipeIds,
    })
  }
  if (actual === null || actual.length > 64_000) {
    return { status: 'protected', raw: actual }
  }

  try {
    const old: unknown = JSON.parse(actual)
    if (!old || typeof old !== 'object' || Array.isArray(old)) {
      return { status: 'protected', raw: actual }
    }
    const record = old as Record<string, unknown>
    if (Object.keys(record).length !== 3 ||
        !['budget', 'activeDays', 'recipeByDay'].every(key => Object.hasOwn(record, key)) ||
        validCustomWeekBudgetEuros(record.budget) === null ||
        !Array.isArray(record.activeDays) ||
        !record.activeDays.every(day => typeof day === 'string' && validDays.includes(day)) ||
        new Set(record.activeDays).size !== record.activeDays.length ||
        !record.recipeByDay || typeof record.recipeByDay !== 'object' ||
        Array.isArray(record.recipeByDay)) return { status: 'protected', raw: actual }

    const previous = record.recipeByDay as Record<string, unknown>
    const oldRows = Object.entries(previous)
    if (oldRows.length > validDays.length) return { status: 'protected', raw: actual }
    const unavailable = new Map(replacements.map(row => [row.day, row]))
    if (unavailable.size !== replacements.length) {
      return { status: 'protected', raw: actual }
    }
    let restored = 0
    for (const [day, recipeId] of oldRows) {
      if (!validDays.includes(day) || typeof recipeId !== 'string' ||
          !recipeId || recipeId !== recipeId.trim()) {
        return { status: 'protected', raw: actual }
      }
      if (validRecipeIds.includes(recipeId)) continue
      const allowed = unavailable.get(day)
      if (!allowed || allowed.previousRecipeId !== recipeId ||
          !validRecipeIds.includes(allowed.fallbackRecipeId) ||
          current.recipeByDay[day] !== allowed.fallbackRecipeId) {
        return { status: 'protected', raw: actual }
      }
      restored += 1
    }
    if (!restored || restored !== unavailable.size) {
      return { status: 'protected', raw: actual }
    }

    // One explicit browser action; the original receipt may not have
    // changed in another tab. All next-state fields pass the strict v2 guard.
    try {
      write(nextRaw)
      return { status: 'saved', raw: nextRaw }
    } catch {
      return { status: 'unavailable', raw: actual }
    }
  } catch {
    return { status: 'protected', raw: actual }
  }
}


/**
 * On a fresh browser load, the ordinary safe preference reader substitutes
 * missing recipe IDs with built-in defaults. Without this narrowly admitted
 * view of the ORIGINAL v2 bytes the user would never see the recovery
 * warning or be able to explicitly repair the still-protected record.
 *
 * Return ONLY missing IDs for otherwise admissible v2 records. Never infer
 * a source, overwrite storage, or inspect unknown/future schema formats.
 */
export function missingStoredOwnRecipeSelections(
  raw: string | null,
  defaultPlan: readonly { day: string; recipeId: string }[],
  validRecipeIds: readonly string[],
): Readonly<Record<string, string>> {
  const nothing: Readonly<Record<string, string>> = {}
  if (!raw || raw.length > 64_000) return nothing
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return nothing
    const record = value as Record<string, unknown>
    if (Object.keys(record).length !== 3 ||
        !['budget', 'activeDays', 'recipeByDay'].every(key => Object.hasOwn(record, key)) ||
        !record.recipeByDay || typeof record.recipeByDay !== 'object' ||
        Array.isArray(record.recipeByDay)) return nothing

    const validDays = defaultPlan.map(meal => meal.day)
    const fallbackByDay = new Map(defaultPlan.map(meal => [meal.day, meal.recipeId]))
    const original = Object.entries(record.recipeByDay as Record<string, unknown>)
    const restored = Object.fromEntries(original)
    const missing: Record<string, string> = Object.create(null)
    for (const [day, recipeId] of original) {
      if (!validDays.includes(day) || typeof recipeId !== 'string' ||
          recipeId !== recipeId.trim() || !recipeId) return nothing
      if (validRecipeIds.includes(recipeId)) continue
      // A missing private recipe is recoverable. An unknown built-in or a
      // future application version must not be mistaken for a deleted recipe.
      const fallback = fallbackByDay.get(day)
      if (!recipeId.startsWith('own-') || !fallback ||
          !validRecipeIds.includes(fallback)) return nothing
      missing[day] = recipeId
      restored[day] = fallback
    }
    if (!Object.keys(missing).length) return nothing
    // This admission checks the complete candidate: exact v2 envelope,
    // legitimate budget/days, and every OTHER saved recipe choice.
    const candidate = JSON.stringify({ ...record, recipeByDay: restored })
    return canReplacePlannerRecord(candidate, validDays, validRecipeIds)
      ? missing : nothing
  } catch {
    return nothing
  }
}
