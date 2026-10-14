import { createElement } from 'react'
import { recipeEstimatePresentation } from './recipeEstimatePresentation.ts'

type RecipePriceExplanationProps = {
  estimatedCost: unknown
}

/**
 * The routed Planner and optional recipe disclosure use one strict cent-valid
 * presentation contract. Preserve the existing native details/summary for
 * keyboard and touch users, including its established explanation copy.
 * A controlled recipe estimate is never an observed retailer/basket price.
 */
export function RecipePriceExplanation({ estimatedCost }: RecipePriceExplanationProps) {
  const presentation = recipeEstimatePresentation(estimatedCost)
  const known = presentation.kind === 'indicative'

  return createElement(
    'div',
    { className: 'recipe-estimate-note', 'data-estimate-status': presentation.kind },
    createElement('small', null, presentation.label),
    createElement(
      'details',
      null,
      createElement(
        'summary',
        null,
        known ? 'Waarom een richtprijs?' : 'Waarom geen richtprijs?',
      ),
      createElement(
        'p',
        null,
        known
          ? 'Dit is een voorbeeldschatting, niet de actuele supermarktprijs. Vergelijk een complete mand; echte winkelprijzen zijn hier niet bevestigd.'
          : 'Voor dit recept is geen betrouwbare richtprijs beschikbaar. Er wordt geen bedrag of besparing geschat.',
      ),
    ),
  )
}
