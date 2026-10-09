import { createElement } from 'react'
import { recipeEstimatePresentation } from './recipeEstimatePresentation.ts'

type RecipeEstimateDisclosureProps = {
  estimatedCost: unknown
}

/**
 * Drop-in for the existing Planner recipe <small> label.
 *
 * The visible text never suggests an exact/current per-recipe basket cost;
 * the explanation is exposed to assistive technology even without hover.
 * No retailer or basket data is read here.
 */
export function RecipeEstimateDisclosure({
  estimatedCost,
}: RecipeEstimateDisclosureProps) {
  const presentation = recipeEstimatePresentation(estimatedCost)

  return createElement(
    'small',
    {
      'data-recipe-cost-kind': presentation.kind,
      title: presentation.explanation,
      'aria-label': `${presentation.label}. ${presentation.explanation}`,
    },
    presentation.label,
  )
}
