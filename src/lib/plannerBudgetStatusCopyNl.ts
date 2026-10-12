import { assessPlannerBudgetCents } from './plannerBudgetCents.ts'
import { euro } from './money.ts'

export type PlannerBudgetStatusCopyNl = {
  text: string
  warning: boolean
  certainty: 'exact' | 'known-minimum' | 'unavailable'
}

/**
 * Make the known-minimum budget meaningful without presenting an unfinished
 * grocery basket as an exact total. This is an integration-ready copy boundary:
 * no basket mutation, source-price lookup, or storage write takes place here.
 */
export function plannerBudgetStatusCopyNl(
  basketTotalCents: unknown,
  budgetEuros: unknown,
  unresolvedLineCount: unknown,
): PlannerBudgetStatusCopyNl {
  const assessment = assessPlannerBudgetCents(
    basketTotalCents,
    budgetEuros,
    unresolvedLineCount,
  )

  if (assessment.status === 'known') {
    const text = assessment.overBudget
      ? `${euro.formatCents(-assessment.remainingCents)} boven budget`
      : `${assessment.remainingLabel} over`

    return { text, warning: assessment.overBudget, certainty: 'exact' }
  }

  if (
    assessment.reason !== 'unresolved-products' ||
    assessment.budgetCents === null ||
    assessment.knownMinimumCents === null ||
    assessment.unresolvedLineCount === null
  ) {
    return { text: 'Budget niet beschikbaar', warning: true, certainty: 'unavailable' }
  }

  const open = `${assessment.unresolvedLineCount} ${assessment.unresolvedLineCount === 1 ? 'mandregel' : 'mandregels'} open`
  // Both amounts come from the validated cent-native adapter. Only an
  // irreversible LOWER BOUND may be disclosed for an unfinished basket.
  if (assessment.knownMinimumCents > assessment.budgetCents) {
    const exceededBy = assessment.knownMinimumCents - assessment.budgetCents
    return {
      text: `Minimaal ${euro.formatCents(exceededBy)} boven budget · ${open}`,
      warning: true,
      certainty: 'known-minimum',
    }
  }

  return { text: open, warning: true, certainty: 'known-minimum' }
}
