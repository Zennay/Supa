import type { PlannedMeal } from './types.ts'
import {
  DEFAULT_PLANNER_BUDGET_OPTIONS,
  parsePlannerPreferences,
  type PlannerPreferences,
} from './plannerPreferences.ts'

// An intentionally bounded optional budget, separate from the legacy chip-only
// persisted contract. Values are exact positive cents from €0,01 to €1.000,00.
export const MAX_CUSTOM_WEEK_BUDGET_CENTS = 100_000

export function parseCustomWeekBudget(input: unknown): number | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  // Accept the grouped Dutch ceiling displayed as €1.000,00, but reject
  // an ambiguous bare "1.000" rather than silently guessing its value.
  const grouped = /^([1-9]\d{0,2})\.(\d{3}),(\d{1,2})$/.exec(value)
  const normalized = grouped === null
    ? value
    : grouped[1] + grouped[2] + ',' + grouped[3]
  if (!/^(?:0|[1-9]\d{0,3})(?:[,.]\d{1,2})?$/.test(normalized)) return null

  const [euros, decimals = ''] = normalized.replace(',', '.').split('.')
  const cents = BigInt(euros) * 100n + BigInt(decimals.padEnd(2, '0') || '0')
  if (cents < 1n || cents > BigInt(MAX_CUSTOM_WEEK_BUDGET_CENTS)) {
    return null
  }
  return Number(cents) / 100
}

export function customWeekBudgetLabel(budget: number): string {
  const cents = Math.round(budget * 100)
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_CUSTOM_WEEK_BUDGET_CENTS ||
      budget !== cents / 100) return ''
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}

function restoredCustomBudget(raw: string | null): number | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !Object.hasOwn(parsed, 'budget')) return null
    const value = (parsed as { budget: unknown }).budget
    if (typeof value !== 'number') return null
    const label = customWeekBudgetLabel(value)
    return label ? parseCustomWeekBudget(label) : null
  } catch {
    return null
  }
}

/**
 * Opt-in custom-budget restore for the actual Supa planner only. Keep the
 * original preference parser's explicit validBudgets contract untouched.
 */
export function parsePlannerPreferencesWithCustomBudget(
  raw: string | null,
  defaultPlan: PlannedMeal[],
  validRecipeIds: string[],
): PlannerPreferences {
  const custom = restoredCustomBudget(raw)
  const budgets = custom === null
    ? DEFAULT_PLANNER_BUDGET_OPTIONS
    : [...DEFAULT_PLANNER_BUDGET_OPTIONS, custom]

  return parsePlannerPreferences(raw, defaultPlan, validRecipeIds, 35, budgets)
}
