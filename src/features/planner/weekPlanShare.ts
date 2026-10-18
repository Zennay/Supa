import type { PlannedMeal, Recipe } from '../../domain/types.ts'
import { euro } from '../../lib/money.ts'

export type ShareableWeek = {
  plannedMeals: readonly PlannedMeal[]
  activeDays: readonly string[]
  recipes: readonly Recipe[]
  budget: number
  includeBudget?: boolean
  includeDetails?: boolean
}

const MAX_DAYS = 14
const MAX_RECIPES = 100
const MAX_LABEL = 120
// The Planner can restore or edit meals in a different insertion order.
// Share a genuine week as a week, rather than exposing storage order.
const WEEKDAY_RANK = new Map<string, number>([
  'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo',
].map((day, index): [string, number] => [day, index]))
// Reject control/format and Unicode line/paragraph separators, including
// zero-width and bidi spoofing. Dutch diacritics and readable non-ASCII stay valid.
const BAD_LABEL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const HAS_VISIBLE_TEXT = /[\p{L}\p{N}]/u
// Several Unicode filler characters are classified as Letters/Symbols even
// though they render as empty space. Never export apparently blank/spoofed
// day, recipe ID or meal title labels in a user-shared weekly plan.
const VISUALLY_BLANK_FILLERS = /[\u115f\u1160\u2800\u3164\uffa0]/u

function safeLabel(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LABEL &&
    value === value.trim() &&
    !BAD_LABEL.test(value) &&
    !VISUALLY_BLANK_FILLERS.test(value) &&
    HAS_VISIBLE_TEXT.test(value)
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
      (input.includeBudget !== undefined && typeof input.includeBudget !== 'boolean') ||
      (input.includeDetails !== undefined && typeof input.includeDetails !== 'boolean') ||
      !Number.isFinite(input.budget) || input.budget < 0 ||
      !Number.isSafeInteger(Math.round(input.budget * 100)) ||
      input.budget !== Math.round(input.budget * 100) / 100) {
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
  const chosen: Array<{ day: string; label: string }> = []
  for (const meal of input.plannedMeals) {
    if (!meal || !safeLabel(meal.day) || !safeLabel(meal.recipeId) ||
        seenDays.has(meal.day)) throw new Error('Weekmenu niet beschikbaar')
    seenDays.add(meal.day)
    if (!active.has(meal.day)) continue
    const recipe = recipeById.get(meal.recipeId)
    if (!recipe) throw new Error('Weekmenu niet beschikbaar')
    if (input.includeDetails && (
      !Number.isSafeInteger(recipe.minutes) || recipe.minutes <= 0 ||
      recipe.minutes > 1440 ||
      !Number.isSafeInteger(recipe.servings) || recipe.servings <= 0 ||
      recipe.servings > 100
    )) throw new Error('Weekmenu niet beschikbaar')

    chosen.push({
      day: meal.day,
      label: `${meal.day}: ${recipe.title}` +
        (input.includeDetails ? ` · ${recipe.minutes} min · ${recipe.servings} ${recipe.servings === 1 ? 'portie' : 'porties'}` : ''),
    })
  }
  if (chosen.length !== active.size) throw new Error('Weekmenu niet beschikbaar')
  // Keep unfamiliar but readable user-defined day labels stable. Standard
  // Dutch day abbreviations always follow Monday -> Sunday, even if saved
  // planner records/active-day toggles were restored in another order.
  const ordered = chosen.sort((a, b) =>
    (WEEKDAY_RANK.get(a.day) ?? 7) - (WEEKDAY_RANK.get(b.day) ?? 7))
    .map(item => item.label)

  return [
    'SUPA · Weekmenu',
    ...(input.includeBudget ? [`Weekbudget (eigen voorkeur): ${euro.format(input.budget)}`] : []),
    '',
    ...(ordered.length ? ordered : ['Geen maaltijden geselecteerd.']),
    '',
    'Dit is een planning, geen prijsopgave.',
    'Receptschattingen en echte winkelprijzen zijn niet inbegrepen.',
  ].join('\n')
}

/**
 * Never show prepared private share text after the user's plan or any sharing
 * preference changes, even during the render before an effect clears state.
 */
export type WeekSharePreview = { sourceKey: string; text: string }

export function currentWeekSharePreview(
  preview: WeekSharePreview | null,
  sourceKey: string,
): string | null {
  return preview && preview.sourceKey === sourceKey ? preview.text : null
}
