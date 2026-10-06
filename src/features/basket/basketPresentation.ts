import { euro } from '../../lib/money'

export type BasketCostDisclosure = {
  state: 'complete' | 'minimum'
  headline: 'Deterministisch mandtotaal' | 'Bekend mandminimum'
  amountLabel: string
  unresolvedLineCount: number
}

export function basketCostDisclosure(
  totalCents: number,
  unresolvedLineCount: number,
): BasketCostDisclosure {
  const complete =
    Number.isInteger(unresolvedLineCount) && unresolvedLineCount === 0
  const safeUnresolvedLineCount =
    Number.isInteger(unresolvedLineCount) && unresolvedLineCount > 0
      ? unresolvedLineCount
      : complete
        ? 0
        : 1
  const formattedAmount = euro.format(totalCents / 100)

  return complete
    ? {
        state: 'complete',
        headline: 'Deterministisch mandtotaal',
        amountLabel: formattedAmount,
        unresolvedLineCount: 0,
      }
    : {
        state: 'minimum',
        headline: 'Bekend mandminimum',
        amountLabel: `min. ${formattedAmount}`,
        unresolvedLineCount: safeUnresolvedLineCount,
      }
}
