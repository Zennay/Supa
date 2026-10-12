import { plannerBudgetStatusCopyNl } from '../../lib/plannerBudgetStatusCopyNl.ts'

type PlannerBudgetStatusWithMinimumProps = {
  basketTotalCents: unknown
  budgetEuros: unknown
  unresolvedLineCount: unknown
}

/**
 * Standalone, owner-integration-ready budget status for the actual planner.
 * An unfinished basket may only show a proven lower-bound overspend, never
 * an exact total or a remaining-budget/savings claim.
 */
export function PlannerBudgetStatusWithMinimum({
  basketTotalCents,
  budgetEuros,
  unresolvedLineCount,
}: PlannerBudgetStatusWithMinimumProps) {
  const copy = plannerBudgetStatusCopyNl(
    basketTotalCents,
    budgetEuros,
    unresolvedLineCount,
  )

  return (
    <span
      className={copy.warning ? 'budget-status warning' : 'budget-status'}
      aria-live="polite"
      data-budget-certainty={copy.certainty}
    >
      {copy.text}
    </span>
  )
}
