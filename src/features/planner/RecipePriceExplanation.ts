import { createElement } from 'react'
import { euro } from '../../lib/money'

type RecipePriceExplanationProps = {
  estimatedCost: unknown
}

/**
 * The controlled recipe catalog contains indicative fixture costs, not observed
 * retailer prices. Never round malformed fractional cents into apparent facts.
 * Native details/summary is keyboard- and touch-operable without custom state.
 */
export function RecipePriceExplanation({ estimatedCost }: RecipePriceExplanationProps) {
  const cents =
    typeof estimatedCost === 'number' &&
    Number.isFinite(estimatedCost) &&
    estimatedCost >= 0 &&
    Number.isSafeInteger(Math.round(estimatedCost * 100)) &&
    estimatedCost === Math.round(estimatedCost * 100) / 100
      ? Math.round(estimatedCost * 100)
      : null

  const known = cents !== null
  return createElement(
    'div',
    { className: 'recipe-estimate-note', 'data-estimate-status': known ? 'indicative' : 'unknown' },
    createElement(
      'small',
      null,
      known ? `Richtprijs: ${euro.formatCents(cents)} / recept` : 'Richtprijs onbekend',
    ),
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
