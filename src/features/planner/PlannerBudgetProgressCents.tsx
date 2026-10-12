import { assessPlannerBudgetCents } from '../../lib/plannerBudgetCents.ts'
import { euro } from '../../lib/money.ts'

type PlannerBudgetProgressCentsProps = {
  basketTotalCents: unknown
  budgetEuros: unknown
  unresolvedLineCount: unknown
}

/**
 * Standalone, owner-disjoint progress presentation for #1041.
 * Percentage is a visual aid only: cent-exact aria-valuetext remains the
 * source of truth, including when the actual cost exceeds 100% of budget.
 * Never render an "under budget" assertion for incomplete basket evidence.
 */
export function PlannerBudgetProgressCents({
  basketTotalCents,
  budgetEuros,
  unresolvedLineCount,
}: PlannerBudgetProgressCentsProps) {
  const assessment = assessPlannerBudgetCents(
    basketTotalCents,
    budgetEuros,
    unresolvedLineCount,
  )
  const budgetCents = assessment.budgetCents
  const knownCents =
    assessment.status === 'known'
      ? assessment.plannedCostCents
      : assessment.reason === 'unresolved-products'
        ? assessment.knownMinimumCents
        : null

  // A zero budget has no meaningful percentage denominator. Malformed
  // inputs never reach ARIA range fields or a made-up zero-width progress.
  if (budgetCents === null || budgetCents === 0 || knownCents === null) {
    return (
      <p className="budget-progress-unavailable" role="status">
        Budgetvoortgang niet beschikbaar
      </p>
    )
  }

  const incomplete = assessment.status === 'unknown'
  // Compute whole percentages in integer cents. Float ratios can turn 29/100
  // into 28.999999..., and multiplying large safe cents by 100 as a Number
  // can lose integer precision. Clamp BEFORE conversion to Number: with a
  // positive denominator the result is guaranteed to be in [0, 99].
  const percent =
    knownCents >= budgetCents
      ? 100
      : Number((BigInt(knownCents) * 100n) / BigInt(budgetCents))
  const amount = euro.formatCents(knownCents)
  const budget = euro.formatCents(budgetCents)
  const status = incomplete
    ? `Bekend minimum: ${amount} van ${budget}; ${assessment.unresolvedLineCount} ${assessment.unresolvedLineCount === 1 ? 'mandregel' : 'mandregels'} open`
    : `Gepland: ${amount} van ${budget}`

  return (
    <div
      className="budget-progress"
      role="progressbar"
      aria-label={incomplete ? 'Bekend minimum van het weekbudget' : 'Gepland deel van het weekbudget'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={status}
      data-budget-certainty={incomplete ? 'known-minimum' : 'exact'}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  )
}
