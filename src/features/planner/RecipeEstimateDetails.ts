import { createElement } from 'react'
import { recipeEstimatePresentation } from './recipeEstimatePresentation.ts'

type RecipeEstimateDetailsProps = {
  estimatedCost: unknown
}

/**
 * Opt-in, keyboard/touch-accessible presentation of *fixture* recipe estimates.
 *
 * This deliberately has no data fetching, price calculation or dependence on
 * the active PlannerView owner. <details>/<summary> works without JavaScript.
 * The final owner integration must still replace the unrouted exact-looking
 * price copy and receive rendered Firefox/mobile review.
 */
export function RecipeEstimateDetails({
  estimatedCost,
}: RecipeEstimateDetailsProps) {
  const estimate = recipeEstimatePresentation(estimatedCost)
  const question =
    estimate.kind === 'indicative'
      ? 'Waarom een richtprijs?'
      : 'Waarom geen richtprijs?'

  return createElement(
    'div',
    {
      className: 'recipe-estimate-explanation',
      'data-recipe-estimate-kind': estimate.kind,
    },
    createElement(
      'small',
      { className: 'recipe-estimate-explanation__label' },
      estimate.label,
    ),
    createElement(
      'details',
      { className: 'recipe-estimate-explanation__details' },
      createElement('summary', null, question),
      createElement('p', null, estimate.explanation),
    ),
  )
}
