import { validCustomWeekBudgetEuros } from './customWeekBudget.ts'

/**
 * Only the exact, supported planner-preferences v2 envelope may be rewritten.
 * Unknown versions and malformed user records are preserved byte-for-byte.
 * This protects the planner key only; shopping progress is a separate namespace.
 */
export function canReplacePlannerRecord(
  raw: string | null,
  validDays: readonly string[],
  validRecipeIds: readonly string[],
): boolean {
  if (raw === null) return true
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length !== 3 ||
        !['budget', 'activeDays', 'recipeByDay'].every((key) => Object.hasOwn(record, key))) {
      return false
    }
    if (validCustomWeekBudgetEuros(record.budget) === null) return false
    if (!Array.isArray(record.activeDays) ||
        !record.activeDays.every((day: unknown) => typeof day === 'string' && validDays.includes(day)) ||
        new Set(record.activeDays).size !== record.activeDays.length) {
      return false
    }
    if (!record.recipeByDay || typeof record.recipeByDay !== 'object' ||
        Array.isArray(record.recipeByDay)) return false
    const recipes = record.recipeByDay as Record<string, unknown>
    return Object.entries(recipes).every(([day, recipeId]) =>
      validDays.includes(day) && typeof recipeId === 'string' && validRecipeIds.includes(recipeId))
  } catch {
    return false
  }
}

export type PlannerStorageWrite = {
  status: 'saved' | 'protected' | 'unavailable'
  raw: string | null
}

/**
 * Validate the current bytes before replacing a saved plan, so one tab cannot
 * silently overwrite an unseen replacement/future envelope.
 *
 * This is an optimistic best-effort check, not an atomic cross-tab transaction.
 * The caller keeps unsaved edits in session state on a non-saved outcome.
 */
export function persistPlannerRecord({
  read,
  write,
  expectedRaw,
  nextRaw,
  validDays,
  validRecipeIds,
}: {
  read: () => string | null
  write: (raw: string) => void
  expectedRaw: string | null
  nextRaw: string
  validDays: readonly string[]
  validRecipeIds: readonly string[]
}): PlannerStorageWrite {
  let current: string | null
  try {
    current = read()
  } catch {
    return { status: 'unavailable', raw: expectedRaw }
  }
  // A deletion made by another tab is a change, too. Treat null as a
  // real expected revision: otherwise an old tab recreates a record the
  // owner explicitly removed elsewhere, without telling them.
  // An explicitly cleared unsupported/future-format record may be replaced
  // on the next intentional planner edit. Its bytes were protected while
  // present; removing them is the user's opt-in recovery path. Conversely,
  // deleting a VALID v2 record in another tab remains a revision conflict:
  // a stale tab must not silently resurrect that deleted week.
  const explicitlyClearedUnsupportedRecord = current === null && expectedRaw !== null &&
    !canReplacePlannerRecord(expectedRaw, validDays, validRecipeIds)
  if ((current !== expectedRaw && !explicitlyClearedUnsupportedRecord) ||
      !canReplacePlannerRecord(current, validDays, validRecipeIds)) {
    return { status: 'protected', raw: current }
  }
  if (!canReplacePlannerRecord(nextRaw, validDays, validRecipeIds)) {
    return { status: 'protected', raw: current }
  }
  if (current === nextRaw) return { status: 'saved', raw: current }
  try {
    write(nextRaw)
    return { status: 'saved', raw: nextRaw }
  } catch {
    return { status: 'unavailable', raw: current }
  }
}
