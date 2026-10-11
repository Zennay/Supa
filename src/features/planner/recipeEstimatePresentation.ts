import { euro } from '../../lib/money.ts'

/**
 * Presentation ONLY for controlled recipe-fixture estimates.
 *
 * Never reuse this for a basket total or an observed retailer price: the
 * fixture is not evidence of a currently purchasable one-recipe basket.
 */
export type RecipeEstimatePresentation = {
  kind: 'indicative' | 'unknown'
  label: string
  explanation: string
}

const RECIPE_ESTIMATE_EXPLANATION =
  'Dit is een richtprijs uit het voorbeeldrecept, niet de actuele prijs van een berekende winkelmand.'

const UNKNOWN_RECIPE_ESTIMATE_EXPLANATION =
  'Er is geen betrouwbare richtprijs voor dit voorbeeldrecept beschikbaar. Bekijk Mand voor bekende productkosten.'

export function recipeEstimatePresentation(
  estimatedCost: unknown,
): RecipeEstimatePresentation {
  if (
    typeof estimatedCost !== 'number' ||
    !Number.isFinite(estimatedCost) ||
    estimatedCost < 0
  ) {
    return {
      kind: 'unknown',
      label: 'Richtprijs onbekend',
      explanation: UNKNOWN_RECIPE_ESTIMATE_EXPLANATION,
    }
  }

  // The shared euro formatter intentionally rejects unsafe or inexact
  // money. Never make its '—' fallback look like a numeric recipe estimate.
  const amount = euro.format(estimatedCost)
  if (amount === '—') {
    return {
      kind: 'unknown',
      label: 'Richtprijs onbekend',
      explanation: UNKNOWN_RECIPE_ESTIMATE_EXPLANATION,
    }
  }

  return {
    kind: 'indicative',
    label: `Richtprijs: ${amount} / recept`,
    explanation: RECIPE_ESTIMATE_EXPLANATION,
  }
}
