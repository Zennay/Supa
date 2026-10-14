import type { PlannedMeal } from '../../domain/types.ts'
import {
  parsePlannerPreferences,
  type PlannerPreferences,
} from '../../domain/plannerPreferences.ts'

export const MAX_CUSTOM_WEEK_BUDGET_CENTS = 100_000

/**
 * Dutch-friendly custom week budgets: parse decimal digits into integer cents,
 * never parseFloat/Math.round user text. No signs, thousands separators,
 * exponents, or fractional cents. A value is committed only on form submit.
 */
export function parseCustomWeekBudgetCents(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(0|[1-9][0-9]{0,3})(?:[,.]([0-9]{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0')
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS
    ? cents
    : null
}

/** Reject JSON floats that cannot denote a cent-exact budget. */
export function validCustomWeekBudgetEuros(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_CUSTOM_WEEK_BUDGET_CENTS) return null
  return value === cents / 100 ? value : null
}

/**
 * App-only persisted preference adapter. The existing strict chip-only domain
 * parser keeps its caller contract unchanged; a validated explicit custom
 * numeric budget replaces only its fallback budget property.
 */
export function restorePlannerPreferencesWithCustomBudget(
  raw: string | null,
  defaultPlan: PlannedMeal[],
  validRecipeIds: string[],
): PlannerPreferences {
  const preferences = parsePlannerPreferences(raw, defaultPlan, validRecipeIds)
  if (!raw) return preferences
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !Object.hasOwn(parsed, 'budget')) return preferences
    const custom = validCustomWeekBudgetEuros((parsed as { budget?: unknown }).budget)
    return custom === null ? preferences : { ...preferences, budget: custom }
  } catch {
    return preferences
  }
}
