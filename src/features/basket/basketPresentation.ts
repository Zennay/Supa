import { euro } from '../../lib/money.ts'

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


export function comparisonWarningCopy(
  baselineUnresolvedLineCount: number,
  candidateUnresolvedLineCount: number,
  reasonCount: number,
): string {
  const baselineOpen =
    Number.isInteger(baselineUnresolvedLineCount) &&
    baselineUnresolvedLineCount > 0
      ? baselineUnresolvedLineCount
      : 0
  const candidateOpen =
    Number.isInteger(candidateUnresolvedLineCount) &&
    candidateUnresolvedLineCount > 0
      ? candidateUnresolvedLineCount
      : 0
  const openProductChoices = baselineOpen + candidateOpen

  if (openProductChoices > 0) {
    return `${openProductChoices} ${
      openProductChoices === 1 ? 'productkeuze moet' : 'productkeuzes moeten'
    } nog worden opgelost voordat SUPA een prijsverschil betrouwbaar kan tonen.`
  }

  if (Number.isInteger(reasonCount) && reasonCount > 0) {
    return 'Deze manden voldoen nog niet aan dezelfde betrouwbare vergelijkingsbasis.'
  }

  return 'SUPA kan voor deze manden nog geen betrouwbaar prijsverschil tonen.'
}
