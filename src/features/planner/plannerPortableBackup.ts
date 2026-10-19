import type { PlannerPreferences } from '../../domain/plannerPreferences.ts'
import { validCustomWeekBudgetEuros } from './customWeekBudget.ts'

/** Explicit user-controlled, portable planner *choices* only.
 * Recipes travel separately through the existing owned-recipe JSON backup.
 * No prices, retailer sources, observations, checked purchases or private API. */
export const PORTABLE_PLANNER_SCHEMA = 'supa-owned-planner-week-v1'
export const PORTABLE_PLANNER_MAX_BYTES = 64_000

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype
const known = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))

function validatedWeek(input: unknown, days: readonly string[], recipeIds: readonly string[]): PlannerPreferences {
  if (!isRecord(input) || !known(input, ['budget', 'activeDays', 'recipeByDay']))
    throw Error('Dit bestand bevat geen geldige weekplanning.')
  const budget = validCustomWeekBudgetEuros(input.budget)
  const active = input.activeDays
  const mapping = input.recipeByDay
  if (budget === null || !Array.isArray(active) || !isRecord(mapping) ||
      days.length < 1 || days.length > 14 || new Set(days).size !== days.length ||
      active.length > days.length || !active.every(d => typeof d === 'string' && days.includes(d)) ||
      new Set(active).size !== active.length ||
      !known(mapping, [...days]) ||
      !Object.entries(mapping).every(([day, recipe]) =>
        days.includes(day) && typeof recipe === 'string' && recipe.length <= 100 && recipe.length > 0)) {
    throw Error('Weekdagen, budget of receptkeuzes zijn ongeldig. Er is niets hersteld.')
  }
  const available = new Set(recipeIds)
  const missing = [...new Set(Object.values(mapping).filter((v): v is string =>
    typeof v === 'string' && !available.has(v)))]
  if (missing.length) throw Error('Importeer eerst de ontbrekende eigen recepten via Recepten (' +
    missing.length + ' recept(en)). De weekplanning is niet gewijzigd.')
  return {
    budget,
    activeDays: days.filter(day => active.includes(day)),
    recipeByDay: Object.fromEntries(days.map(day => [day, mapping[day] as string])),
  }
}

export function exportOwnedPlannerWeek(
  value: PlannerPreferences, days: readonly string[], recipeIds: readonly string[],
): string {
  const checked = validatedWeek(value, days, recipeIds)
  const text = JSON.stringify({
    schema: PORTABLE_PLANNER_SCHEMA,
    days: [...days],
    preferences: checked,
  }, null, 2) + '\n'
  if (new TextEncoder().encode(text).length > PORTABLE_PLANNER_MAX_BYTES)
    throw Error('Deze weekplanning is te groot voor export.')
  return text
}

export function previewOwnedPlannerWeek(
  text: string, days: readonly string[], recipeIds: readonly string[],
): PlannerPreferences {
  if (typeof text !== 'string' || !text ||
      new TextEncoder().encode(text).length > PORTABLE_PLANNER_MAX_BYTES)
    throw Error('Kies een weekplanning van maximaal 64 kB.')
  let input: unknown
  try { input = JSON.parse(text) }
  catch { throw Error('Geen geldige JSON-weekplanning.') }
  if (!isRecord(input) || !known(input, ['schema', 'days', 'preferences']) ||
      input.schema !== PORTABLE_PLANNER_SCHEMA ||
      !Array.isArray(input.days) || input.days.length !== days.length ||
      input.days.some((day, index) => day !== days[index])) {
    throw Error('Andere of onbekende weekplanning. De huidige Planner blijft intact.')
  }
  return validatedWeek(input.preferences, days, recipeIds)
}
