/**
 * Offline shopping list from private reviewed manual recipes, no retailer data.
 * Reuses Supa's ONE basket aggregator and existing copy/print presentation.
 * Never exposes numeric basket totals or a synthetic store-price estimate.
 */
import { buildOneStoreBasket, type RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { preparePrintableShoppingChecklist, type PrintableShoppingChecklistData } from '../shopping-list/printableShoppingChecklist.ts'
import { buildShoppingListCopyText } from '../shopping-list/shoppingListCopyText.ts'
import type { UnpricedPrivateRecipe } from './reviewedRecipeBasketBridge.ts'

export type UnpricedShoppingPreview =
  | { status: 'unavailable'; reason: 'invalid_or_incomplete_plan' }
  | {
      status: 'manual_review_only'
      checklist: PrintableShoppingChecklistData
      copyText: string
      unresolvedItemCount: number
      retailerPricesKnown: false
      savingsVerified: false
    }

/**
 * A review-only shopping checklist is useful BEFORE a supermarket has been
 * selected. No actual store products are supplied; every item must remain a
 * user-reviewed purchase decision with no current prices or savings claim.
 *
 * The legacy RecipeWithIngredients demands a number for estimatedCost.
 * Number.NaN is an intentionally NON-finite internal compatibility sentinel,
 * never a customer-facing price. Only copy/print data leaves this function.
 */
export function prepareUnpricedShoppingPreview(
  plan: readonly PlannedMeal[],
  privateRecipes: readonly UnpricedPrivateRecipe[],
  activeDays: readonly string[],
): UnpricedShoppingPreview {
  const unavailable: UnpricedShoppingPreview = {
    status: 'unavailable',
    reason: 'invalid_or_incomplete_plan',
  }
  if (!Array.isArray(plan) || !Array.isArray(privateRecipes) ||
    !Array.isArray(activeDays) || activeDays.length === 0 ||
    activeDays.length > 7 || privateRecipes.length === 0 ||
    privateRecipes.length > 7 || plan.length > 7) return unavailable

  const ids = new Set<string>()
  for (const recipe of privateRecipes) {
    if (!recipe || recipe.estimatedCost !== null ||
      recipe.priceStatus !== 'unknown' ||
      recipe.provenance !== 'local_manual_review' ||
      typeof recipe.id !== 'string' ||
      !/^private-recipe:[A-Za-z0-9_-]{1,64}$/.test(recipe.id) ||
      ids.has(recipe.id) || !Array.isArray(recipe.ingredients) ||
      recipe.ingredients.length === 0 || recipe.ingredients.length > 100 ||
      typeof recipe.title !== 'string' || recipe.title.trim().length < 2 ||
      !Number.isSafeInteger(recipe.minutes) || recipe.minutes <= 0 ||
      !Number.isSafeInteger(recipe.servings) || recipe.servings < 1 ||
      recipe.servings > 1000 || !Array.isArray(recipe.tags) ||
      recipe.ingredients.some((row) => !row ||
        typeof row.id !== 'string' || !row.id.startsWith('private-ingredient:') ||
        typeof row.label !== 'string' || !row.label.trim() ||
        typeof row.query !== 'string' || !row.query.trim() ||
        !['g', 'ml', 'piece'].includes(row.unit) ||
        typeof row.amount !== 'number' || !Number.isFinite(row.amount) ||
        row.amount <= 0 || row.amount > 1_000_000)) return unavailable
    ids.add(recipe.id)
  }
  if (!plan.every((meal) => meal && typeof meal.day === 'string' &&
    typeof meal.recipeId === 'string' && ids.has(meal.recipeId))) {
    return unavailable
  }

  try {
    const runtimeRecipes: RecipeWithIngredients[] = privateRecipes.map((recipe) => ({
      ...recipe,
      // Legacy numeric-only contract: NOT a 0-euro estimate.
      estimatedCost: Number.NaN,
      tags: [...recipe.tags],
      ingredients: recipe.ingredients.map((row) => ({ ...row })),
    }))
    const basket = buildOneStoreBasket({
      store: { id: 'private-offline-unpriced', name: 'Winkel nog te kiezen' },
      plan: plan.map((meal) => ({ ...meal })),
      recipes: runtimeRecipes,
      activeDays: [...activeDays],
      products: [],
    })
    // All ingredient decisions must remain unresolved until actual products
    // and per-source rights/provenance are verified elsewhere.
    if (basket.matchedLineCount !== 0 ||
      basket.unresolvedLineCount !== basket.lines.length ||
      basket.lines.length === 0) return unavailable

    const checklist = preparePrintableShoppingChecklist(basket)
    const copyText = buildShoppingListCopyText(basket)
    if (!copyText || checklist.reviewCount !== basket.unresolvedLineCount ||
      checklist.lines.length !== basket.lines.length ||
      checklist.lines.some((line) => !line.needsReview)) return unavailable

    return {
      status: 'manual_review_only',
      checklist,
      copyText,
      unresolvedItemCount: checklist.reviewCount,
      retailerPricesKnown: false,
      savingsVerified: false,
    }
  } catch {
    return unavailable
  }
}
