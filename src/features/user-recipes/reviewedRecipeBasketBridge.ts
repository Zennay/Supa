/**
 * Isolated offline bridge from reviewed private manual draft to basket shape.
 * Does not invent an estimated price, store, URL fetch, or account identity.
 */
import { canConfirmUserRecipeDraft, type EditorRecipeDraft } from './userRecipeDraftEditor.ts'
import type { RecipeWithIngredients } from '../../domain/basket.ts'

export type UnpricedPrivateRecipe = Omit<RecipeWithIngredients, 'estimatedCost'> & {
  estimatedCost: null
  provenance: 'local_manual_review'
  priceStatus: 'unknown'
}

export type PrivateRecipeBasketDecision =
  | { status: 'review_required'; reasons: string[] }
  | { status: 'unpriced_ready'; recipe: UnpricedPrivateRecipe }

/**
 * Returns an unpriced candidate ONLY after explicit editor review.
 * A different authorized layer must handle pricing, account ownership,
 * import/fetch provenance and eventual App navigation.
 */
export function prepareUnpricedPrivateRecipe(
  draft: EditorRecipeDraft,
  localId: string,
  existingRecipeIds: readonly string[] = [],
): PrivateRecipeBasketDecision {
  const reasons: string[] = []
  const safeId = typeof localId === 'string' ? localId.trim() : ''
  const finalId = 'private-recipe:' + safeId

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(safeId)) reasons.push('invalid_private_recipe_id')
  if (!Array.isArray(existingRecipeIds) || existingRecipeIds.includes(finalId)) {
    reasons.push('duplicate_or_invalid_recipe_id')
  }
  if (!draft || draft.source !== 'manual') reasons.push('source_requires_separate_import_review')
  if (!draft || !Array.isArray(draft.warnings) || draft.warnings.length > 0) {
    reasons.push('outstanding_recipe_warnings')
  }
  if (!draft || !canConfirmUserRecipeDraft(draft)) reasons.push('draft_not_reviewed')
  if (!draft || !Number.isSafeInteger(draft.minutes) || (draft.minutes ?? 0) < 1) {
    reasons.push('missing_or_invalid_preparation_time')
  }
  if (!draft || !Array.isArray(draft.ingredients)) {
    reasons.push('invalid_ingredients')
  } else {
    for (const ingredient of draft.ingredients) {
      // Parser #3264 and independent QA #3286 cap each metric ingredient
      // at 1,000,000. The editor currently permits 1e9: refuse here
      // rather than silently widening the trusted planner contract.
      if (!ingredient || typeof ingredient.amount !== 'number' ||
        !Number.isFinite(ingredient.amount) || ingredient.amount <= 0 ||
        ingredient.amount > 1_000_000) {
        reasons.push('metric_amount_exceeds_import_contract')
        break
      }
      // A portion of an indivisible shopping item cannot be assumed to be
      // a purchasable whole item without a separate explicit review contract.
      // Grams and millilitres may still contain legitimate metric decimals.
      if (ingredient.unit === 'piece' && !Number.isInteger(ingredient.amount)) {
        reasons.push('fractional_piece_requires_human_review')
        break
      }
      if (!ingredient ||
        typeof ingredient.query !== 'string' ||
        !ingredient.query.trim() ||
        ingredient.query.trim().length > 180 ||
        /[\u0000-\u001F\u007F]/u.test(ingredient.query)) {
        reasons.push('invalid_ingredient_query')
        break
      }
      try {
        encodeURIComponent(ingredient.query.trim().normalize('NFC').toLocaleLowerCase('nl-NL'))
      } catch {
        reasons.push('invalid_ingredient_encoding')
        break
      }
    }
  }
  if (reasons.length > 0) return { status: 'review_required', reasons }

  const recipe: UnpricedPrivateRecipe = {
    id: finalId,
    title: draft.title.trim(),
    minutes: draft.minutes as number,
    servings: draft.servings as number,
    estimatedCost: null,
    tags: [],
    provenance: 'local_manual_review',
    priceStatus: 'unknown',
    ingredients: draft.ingredients.map((ingredient) => {
      const query = ingredient.query.trim().normalize('NFC').toLocaleLowerCase('nl-NL')
      const unit = ingredient.unit as 'g' | 'ml' | 'piece'
      return {
        id: 'private-ingredient:' + encodeURIComponent(query) + ':' + unit,
        label: query,
        query,
        amount: ingredient.amount,
        unit,
      }
    }),
  }
  return { status: 'unpriced_ready', recipe }
}
