import type { BasketComparison } from '../../domain/comparison.ts'

export type BasketComparisonPresentation = {
  status: 'claimable' | 'unknown'
  title: string
  detail: string
  deltaLabel: string
}

function euroDelta(cents: number) {
  return `€ ${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`
}

export function presentBasketComparison(
  comparison: BasketComparison,
  baselineName: string,
  candidateName: string,
): BasketComparisonPresentation {
  if (!comparison.claimable || comparison.deltaCents === null) {
    return {
      status: 'unknown',
      title: 'Nog geen betrouwbare vergelijking',
      detail:
        comparison.reasons[0] ??
        'De twee manden zijn niet volledig of niet één-op-één vergelijkbaar.',
      deltaLabel: 'Geen financieel verschil getoond',
    }
  }

  if (comparison.direction === 'cheaper') {
    return {
      status: 'claimable',
      title: `${candidateName} is lager in deze gecontroleerde test`,
      detail: `Zelfde weekvraag vergeleken met ${baselineName}; dit is rekenbewijs, geen waargenomen besparing.`,
      deltaLabel: `${euroDelta(comparison.deltaCents)} lager`,
    }
  }

  if (comparison.direction === 'worse') {
    return {
      status: 'claimable',
      title: `${candidateName} is hoger in deze gecontroleerde test`,
      detail: `SUPA bewaart ook negatieve uitkomsten ten opzichte van ${baselineName}; er wordt geen winst geforceerd.`,
      deltaLabel: `${euroDelta(comparison.deltaCents)} hoger`,
    }
  }

  return {
    status: 'claimable',
    title: 'Beide gecontroleerde manden zijn even duur',
    detail: `${baselineName} en ${candidateName} hebben voor dezelfde weekvraag hetzelfde testtotaal.`,
    deltaLabel: '€ 0,00 verschil',
  }
}
