/**
 * Safe, pure portion scaling for reviewed/private user-recipe drafts.
 * Accepts only canonical metric quantities from the separate import boundary.
 * This module NEVER performs ingredient matching, prices, or persistence.
 */
export type RecipeMetricUnit = 'g' | 'ml' | 'piece'

export type PortionIngredient = {
  amount: number | null
  unit: RecipeMetricUnit | null
  reviewReason: string | null
}

export type PortionDraft = {
  servings: number | null
  ingredients: PortionIngredient[]
}

export type PortionWarningCode =
  | 'unknown_base_servings'
  | 'unknown_ingredient'
  | 'invalid_ingredient'
  | 'quantity_below_precision'
  | 'quantity_over_limit'
  | 'rounded_quantity'
  | 'fractional_piece'
  | 'prior_review_required'

export type PortionWarning = {
  ingredientIndex: number | null
  code: PortionWarningCode
}

export type PortionScaleResult<T extends PortionDraft> = {
  draft: T
  status: 'scaled' | 'needs_review'
  warnings: PortionWarning[]
}

const MAX_SERVINGS = 1000
const MAX_QUANTITY = 1_000_000_000
const QUANTITY_SCALE = 1000 // grams/millilitres/pieces: at most 3 decimals

/**
 * The input and its nested ingredients are never modified. Fields besides
 * servings, amount and reviewReason (e.g. steps, origin URL) are preserved.
 * Unknown or unsupported units cannot magically become valid quantities.
 */
export function scaleMetricRecipeDraft<T extends PortionDraft>(
  source: T,
  requestedServings: number,
): PortionScaleResult<T> {
  if (!Number.isSafeInteger(requestedServings) || requestedServings < 1 || requestedServings > MAX_SERVINGS) {
    throw new RangeError('Target portions must be a whole number from 1 to 1000')
  }
  if (!source || !Array.isArray(source.ingredients)) {
    throw new TypeError('A recipe with ingredients is required')
  }

  const warnings: PortionWarning[] = []
  const oldServings = source.servings
  if (typeof oldServings !== 'number' || !Number.isFinite(oldServings) || oldServings <= 0 || oldServings > MAX_SERVINGS) {
    return {
      draft: { ...source, ingredients: source.ingredients.map((ingredient) => ({ ...ingredient })) } as T,
      status: 'needs_review',
      warnings: [{ ingredientIndex: null, code: 'unknown_base_servings' }],
    }
  }

  const ingredients = source.ingredients.map((ingredient, index) => {
    const cloned = { ...ingredient }
    if (cloned.reviewReason) {
      warnings.push({ ingredientIndex: index, code: 'prior_review_required' })
    }
    if (cloned.amount === null || cloned.unit === null) {
      warnings.push({ ingredientIndex: index, code: 'unknown_ingredient' })
      return { ...cloned, amount: null, reviewReason: cloned.reviewReason || 'Controleer de ontbrekende hoeveelheid of eenheid.' }
    }
    if (!['g', 'ml', 'piece'].includes(cloned.unit) || !Number.isFinite(cloned.amount) || cloned.amount <= 0 || cloned.amount > MAX_QUANTITY) {
      warnings.push({ ingredientIndex: index, code: 'invalid_ingredient' })
      return { ...cloned, amount: null, reviewReason: cloned.reviewReason || 'Ongeldige metrische hoeveelheid: handmatige controle nodig.' }
    }

    const exact = cloned.amount * requestedServings / oldServings
    if (!Number.isFinite(exact) || exact > MAX_QUANTITY) {
      warnings.push({ ingredientIndex: index, code: 'quantity_over_limit' })
      return { ...cloned, amount: null, reviewReason: cloned.reviewReason || 'De geschaalde hoeveelheid valt buiten de toegestane grens.' }
    }
    const scaled = Math.round(exact * QUANTITY_SCALE) / QUANTITY_SCALE
    if (scaled <= 0 || !Number.isFinite(scaled)) {
      warnings.push({ ingredientIndex: index, code: 'quantity_below_precision' })
      return { ...cloned, amount: null, reviewReason: cloned.reviewReason || 'Hoeveelheid kleiner dan 0,001: pas handmatig aan.' }
    }
    if (Math.abs(exact - scaled) > 1e-9) {
      warnings.push({ ingredientIndex: index, code: 'rounded_quantity' })
    }
    if (cloned.unit === 'piece' && !Number.isInteger(scaled)) {
      warnings.push({ ingredientIndex: index, code: 'fractional_piece' })
      return { ...cloned, amount: scaled, reviewReason: cloned.reviewReason || 'Controleer of een deel van een stuk bruikbaar is.' }
    }
    return { ...cloned, amount: scaled }
  })

  return {
    draft: { ...source, servings: requestedServings, ingredients } as T,
    status: warnings.length ? 'needs_review' : 'scaled',
    warnings,
  }
}
