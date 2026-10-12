import { assessPlannerBudgetCents } from '../../lib/plannerBudgetCents.ts'
import { euro } from '../../lib/money.ts'

type PlannerBudgetMoneyStatusProps = {
  basketTotalCents: unknown
  budgetEuros: unknown
  unresolvedLineCount: unknown
}

/**
 * Presentation-only replacement for the floating-point budget status.
 * Intended for owner-approved wiring into PlannerView after #423 settles.
 *
 * The basket remains the sole price source. Incomplete or malformed evidence
 * never receives an invented exact remainder or an under-budget claim.
 */
export function PlannerBudgetMoneyStatus({
  basketTotalCents,
  budgetEuros,
  unresolvedLineCount,
}: PlannerBudgetMoneyStatusProps) {
  const assessment = assessPlannerBudgetCents(
    basketTotalCents,
    budgetEuros,
    unresolvedLineCount,
  )

  if (assessment.status === 'unknown') {
    const copy =
      assessment.reason === 'unresolved-products' &&
      assessment.unresolvedLineCount !== null
        ? `${assessment.unresolvedLineCount} ${assessment.unresolvedLineCount === 1 ? 'mandregel' : 'mandregels'} open`
        : 'Budget niet beschikbaar'

    return (
      <span className="budget-status warning" aria-live="polite">
        {copy}
      </span>
    )
  }

  const copy = assessment.overBudget
    ? `${euro.formatCents(-assessment.remainingCents)} boven budget`
    : `${assessment.remainingLabel} over`

  return (
    <span
      className={assessment.overBudget ? 'budget-status warning' : 'budget-status'}
      aria-live="polite"
    >
      {copy}
    </span>
  )
}
