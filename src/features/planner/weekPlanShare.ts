import type { PlannedMeal, Recipe } from '../../domain/types.ts'
import { euro } from '../../lib/money.ts'

export type ShareableWeek = {
  plannedMeals: readonly PlannedMeal[]
  activeDays: readonly string[]
  recipes: readonly Recipe[]
  budget: number
}

const MAX_DAYS = 14
const MAX_RECIPES = 100
const MAX_LABEL = 120
const BAD_LABEL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/

function safeLabel(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LABEL &&
    value === value.trim() &&
    !BAD_LABEL.test(value)
}

/**
 * Human-facing, entirely offline copy of the *selected* meal plan.
 * Do not project sample recipe estimates, retailer prices or savings into it.
 * Fail closed rather than silently share stale or ambiguous recipe identities.
 */
export function formatShareableWeek(input: ShareableWeek): string {
  if (!input || !Array.isArray(input.plannedMeals) ||
      !Array.isArray(input.activeDays) || !Array.isArray(input.recipes) ||
      input.plannedMeals.length > MAX_DAYS ||
      input.activeDays.length > MAX_DAYS ||
      input.recipes.length > MAX_RECIPES ||
      !Number.isFinite(input.budget) || input.budget < 0) {
    throw new Error('Weekmenu niet beschikbaar')
  }

  const active = new Set<string>()
  for (const day of input.activeDays) {
    if (!safeLabel(day) || active.has(day)) throw new Error('Weekmenu niet beschikbaar')
    active.add(day)
  }

  const recipeById = new Map<string, Recipe>()
  for (const recipe of input.recipes) {
    if (!recipe || !safeLabel(recipe.id) || !safeLabel(recipe.title) ||
        recipeById.has(recipe.id)) throw new Error('Weekmenu niet beschikbaar')
    recipeById.set(recipe.id, recipe)
  }

  const seenDays = new Set<string>()
  const chosen: string[] = []
  for (const meal of input.plannedMeals) {
    if (!meal || !safeLabel(meal.day) || !safeLabel(meal.recipeId) ||
        seenDays.has(meal.day)) throw new Error('Weekmenu niet beschikbaar')
    seenDays.add(meal.day)
    if (!active.has(meal.day)) continue
    const recipe = recipeById.get(meal.recipeId)
    if (!recipe) throw new Error('Weekmenu niet beschikbaar')
    chosen.push(`${meal.day}: ${recipe.title}`)
  }
  if (chosen.length !== active.size) throw new Error('Weekmenu niet beschikbaar')

  const budgetLabel = euro.format(input.budget)
  return [
    'SUPA · Weekmenu',
    `Weekbudget (eigen voorkeur): ${budgetLabel}`,
    '',
    ...(chosen.length ? chosen : ['Geen maaltijden geselecteerd.']),
    '',
    'Dit is een planning, geen prijsopgave.',
    'Receptschattingen en echte winkelprijzen zijn niet inbegrepen.',
  ].join('\n')
}
