import { assessPlannerBudgetCents } from '../../lib/plannerBudgetCents.ts'
import { euro } from '../../lib/money.ts'

type PlannerBasketSummaryCentsProps = {
  basketTotalCents: unknown
  budgetEuros: unknown
  unresolvedLineCount: unknown
}

/**
 * A basket summary is an exact amount only when every product was resolved.
 * Open matches allow a known minimum, never a false final total or saving.
 * Independently staged for coordinated PlannerView ownership (#1041).
 */
export function PlannerBasketSummaryCents({
  basketTotalCents,
  budgetEuros,
  unresolvedLineCount,
}: PlannerBasketSummaryCentsProps) {
  const assessment = assessPlannerBudgetCents(
    basketTotalCents,
    budgetEuros,
    unresolvedLineCount,
  )

  if (assessment.status === 'known') {
    return (
      <strong data-budget-certainty="exact">
        {euro.formatCents(assessment.plannedCostCents)}
      </strong>
    )
  }

  if (
    assessment.reason === 'unresolved-products' &&
    assessment.knownMinimumCents !== null &&
    assessment.unresolvedLineCount !== null
  ) {
    const amount = euro.formatCents(assessment.knownMinimumCents)
    const open = `${assessment.unresolvedLineCount} ${assessment.unresolvedLineCount === 1 ? 'mandregel' : 'mandregels'} open`
    return (
      <strong
        data-budget-certainty="known-minimum"
        aria-label={`Bekend minimum ${amount}; ${open}`}
      >
        min. {amount}
      </strong>
    )
  }

  return (
    <strong data-budget-certainty="unavailable">
      Bedrag onbekend
    </strong>
  )
}
