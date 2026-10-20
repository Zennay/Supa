import { aggregatePlanIngredients } from '../../domain/basket.ts'
import { makeBlankPlannerCaptureCsv, type CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'
import { makePlannerCaptureGuide } from '../comparison/plannerPriceCaptureGuide.ts'
import { exportCombinedRecipesPrivateWeek } from './exportCombinedRecipesPrivateWeek.ts'
import type { SavedRecipe } from './recipeLibrary.ts'

type CanonicalWeek = {
  plan: { day: string; recipeId: string }[]
  activeDays: string[]
  recipes: Parameters<typeof aggregatePlanIngredients>[1]
}

/** Exactly the same unpriced physical demand used in the private basket mapper.
 * Delegate the full recipe, portion and selected-week checks to its existing
 * canonical exporter before producing the existing approved nine-column CSV.
 * No retailer SKU, observed time, price, availability or source right inferred.
 */
export function combinedRecipesCaptureKit(
  recipes: readonly SavedRecipe[],
  portionsById: Readonly<Record<string, number>>,
  stores: readonly CaptureStore[],
): { csv: string; guide: string; storeLabel: string; rows: { csvRow: number; store: CaptureStore; id: string; label: string; amount: number; unit: string }[] } {
  const week = JSON.parse(exportCombinedRecipesPrivateWeek(recipes, portionsById)) as CanonicalWeek
  const needs = aggregatePlanIngredients(week.plan, week.recipes, week.activeDays)
  if (needs.length < 1 || needs.length > 200 ||
      needs.some(item => item.amount === null || !Number.isFinite(item.amount) ||
        item.amount <= 0 || (item.unit === 'piece' && !Number.isSafeInteger(item.amount)))) {
    throw new Error('Corrigeer de oorspronkelijke fysieke hoeveelheden vóór je winkelproducten opneemt.')
  }
  // Both formats MUST receive the same canonical demand and store order.
  return {
    csv: makeBlankPlannerCaptureCsv(needs, stores, ';'),
    guide: 'SUPA · eigen receptenbundel · ' + recipes.length + ' recepten\n' +
      makePlannerCaptureGuide(needs, stores),
    storeLabel: stores.join('-').toLowerCase(),
    // The existing CSV emits one row per store × original canonical need,
    // store-major starting after the nine-column header. Reuse EXACTLY that
    // order to preview the otherwise unlabelled editable CSV rows in-app.
    rows: stores.flatMap((store, storeIndex) => needs.map((need, ingredientIndex) => ({
      csvRow: storeIndex * needs.length + ingredientIndex + 2,
      store, id: need.id, label: need.label, amount: need.amount!, unit: need.unit,
    }))),
  }
}
