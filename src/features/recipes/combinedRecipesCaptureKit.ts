import { aggregatePlanIngredients } from '../../domain/basket.ts'
import { makeBlankPlannerCaptureCsv, type CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'
import { makePlannerCaptureGuide } from '../comparison/plannerPriceCaptureGuide.ts'
import { exportCombinedRecipesPrivateWeek } from './exportCombinedRecipesPrivateWeek.ts'
import { combinedImportedRecipeGroceries, type GroceryContribution } from './combinedImportedRecipeGroceries.ts'
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
): { csv: string; guide: string; storeLabel: string; rows: { csvRow: number; store: CaptureStore; id: string; label: string; amount: number; unit: string; sources: GroceryContribution[] }[] } {
  const week = JSON.parse(exportCombinedRecipesPrivateWeek(recipes, portionsById)) as CanonicalWeek
  const needs = aggregatePlanIngredients(week.plan, week.recipes, week.activeDays)
  if (needs.length < 1 || needs.length > 200 ||
      needs.some(item => item.amount === null || !Number.isFinite(item.amount) ||
        item.amount <= 0 || (item.unit === 'piece' && !Number.isSafeInteger(item.amount)))) {
    throw new Error('Corrigeer de oorspronkelijke fysieke hoeveelheden vóór je winkelproducten opneemt.')
  }
  // Link physical week-demand rows back to the ACTUAL original recipe lines.
  // Ingredient IDs come only from toPlannerRecipe's canonical query+unit
  // identity, never display labels or a retailer SKU. Keep all contributors,
  // even when multiple source rows belong to the same recipe.
  const combined = combinedImportedRecipeGroceries(recipes, portionsById)
  if (!combined.complete)
    throw new Error('Controleer alle oorspronkelijke ingrediëntregels vóór de winkelopname.')
  const sourcesByNeedId = new Map<string, GroceryContribution[]>()
  for (const line of combined.checklist.lines) {
    if (!line.needsReview && line.query && line.unit)
      sourcesByNeedId.set(
        'own-ingredient:' + line.query + ':' + line.unit,
        combined.contributorsByLine[line.key] ?? [],
      )
  }
  // Both formats MUST receive the same canonical demand and store order.
  return {
    csv: makeBlankPlannerCaptureCsv(needs, stores, ';'),
    guide: 'SUPA · eigen receptenbundel · ' + recipes.length + ' recepten\n' +
      'LET OP: de lege bron-CSV bevat standaard beschikbaar=false. Zet dit alleen op true ' +
      'als het originele winkelproduct werkelijk beschikbaar is én je de verpakking, prijs en ' +
      'het echte observatiemoment hebt opgenomen. Een leeg product is NOOIT een gratis product.\n\n' +
      makePlannerCaptureGuide(needs, stores),
    storeLabel: stores.join('-').toLowerCase(),
    // The existing CSV emits one row per store × original canonical need,
    // store-major starting after the nine-column header. Reuse EXACTLY that
    // order to preview the otherwise unlabelled editable CSV rows in-app.
    rows: stores.flatMap((store, storeIndex) => needs.map((need, ingredientIndex) => ({
      csvRow: storeIndex * needs.length + ingredientIndex + 2,
      store, id: need.id, label: need.label, amount: need.amount!, unit: need.unit,
      sources: sourcesByNeedId.get(need.id) ?? [],
    }))),
  }
}
