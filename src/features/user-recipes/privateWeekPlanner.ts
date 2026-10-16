/**
 * Controlled one-week private recipe planner, intentionally not mounted in App.
 * No account write, no retailer fetch, no guessed price. The existing basket
 * is the only place ingredients are aggregated.
 */
import type { PlannedMeal } from '../../domain/types.ts'
import type { UnpricedPrivateRecipe } from './reviewedRecipeBasketBridge.ts'
import { prepareUnpricedShoppingPreview, type UnpricedShoppingPreview } from './unpricedShoppingPreview.ts'

export const privateWeekDays = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'] as const
export type PrivateWeekDay = typeof privateWeekDays[number]
export type PrivateWeekSelection = Readonly<Record<string, string | null | undefined>>

export type PrivateWeekResult =
  | { status: 'review_required'; reason: 'invalid_selection' | 'no_recipes_selected' }
  | { status: 'preview_ready'; days: PrivateWeekDay[]; plan: PlannedMeal[]; preview: Extract<UnpricedShoppingPreview, { status: 'manual_review_only' }> }

/**
 * Protect read-only planner candidates against unknown day keys, duplicate
 * recipe IDs, untrusted accessors and accidental incomplete basket states.
 * Non-selected days are allowed; the existing core basket gets the exact
 * selected-day set and rejects contradictory data before checklist output.
 */
export function createPrivateRecipeWeekPreview(
  recipes: readonly UnpricedPrivateRecipe[],
  selection: PrivateWeekSelection,
): PrivateWeekResult {
  const invalid: PrivateWeekResult = { status: 'review_required', reason: 'invalid_selection' }
  if (!Array.isArray(recipes) || !selection || typeof selection !== 'object' ||
      Array.isArray(selection) || recipes.length === 0 || recipes.length > 100) {
    return invalid
  }
  try {
    const prototype = Object.getPrototypeOf(selection)
    if (prototype !== Object.prototype && prototype !== null) return invalid
    const descriptors = Object.getOwnPropertyDescriptors(selection)
    const days = new Set<string>(privateWeekDays)
    const knownRecipes = new Set<string>()
    for (const recipe of recipes) {
      if (!recipe || typeof recipe.id !== 'string' ||
          knownRecipes.has(recipe.id)) return invalid
      knownRecipes.add(recipe.id)
    }
    for (const [day, descriptor] of Object.entries(descriptors)) {
      if (!days.has(day) || !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
          !('value' in descriptor) ||
          !(descriptor.value == null ||
            (typeof descriptor.value === 'string' &&
             (descriptor.value === '' || knownRecipes.has(descriptor.value))))) {
        return invalid
      }
    }

    const plan: PlannedMeal[] = []
    const activeDays: PrivateWeekDay[] = []
    for (const day of privateWeekDays) {
      const choice = descriptors[day]?.value
      if (typeof choice === 'string' && choice.length > 0) {
        plan.push({ day, recipeId: choice })
        activeDays.push(day)
      }
    }
    if (plan.length === 0) return { status: 'review_required', reason: 'no_recipes_selected' }
    const chosen = recipes.filter((recipe) => plan.some((meal) => meal.recipeId === recipe.id))
    const preview = prepareUnpricedShoppingPreview(plan, chosen, activeDays)
    if (preview.status !== 'manual_review_only') return invalid

    return { status: 'preview_ready', days: activeDays, plan, preview }
  } catch {
    return invalid
  }
}
