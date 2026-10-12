import { assessPlannerBudgetCents } from '../../lib/plannerBudgetCents.ts'
import { euro } from '../../lib/money.ts'
import { PlannerBudgetStatusWithMinimum } from './PlannerBudgetStatusWithMinimum.tsx'
import { PlannerBudgetProgressCents } from './PlannerBudgetProgressCents.tsx'
import { PlannerBasketSummaryCents } from './PlannerBasketSummaryCents.tsx'

type PlannerBudgetCardCentsProps = {
  budgetEuros: number
  basketTotalCents: unknown
  unresolvedLineCount: unknown
  activeMealCount: number
  onBudgetChange: (budgetEuros: number) => void
}

const presetBudgets = [30, 35, 40] as const

/**
 * Owner-disjoint, integration-ready replacement for the Planner budget card.
 * All three pieces consume the SAME cent-based inputs; the visible progress,
 * exact/minimum summary and warning therefore cannot disagree about the
 * basket's certainty. The existing routed PlannerView is not changed here.
 */
export function PlannerBudgetCardCents({
  budgetEuros,
  basketTotalCents,
  unresolvedLineCount,
  activeMealCount,
  onBudgetChange,
}: PlannerBudgetCardCentsProps) {
  const assessment = assessPlannerBudgetCents(
    basketTotalCents,
    budgetEuros,
    unresolvedLineCount,
  )
  const unresolved = assessment.status === 'unknown' &&
    assessment.reason === 'unresolved-products'
  const budgetLabel = assessment.budgetCents === null
    ? 'Budget onbekend'
    : euro.formatCents(assessment.budgetCents)
  const mealCountLabel =
    Number.isSafeInteger(activeMealCount) && activeMealCount >= 0
      ? `${activeMealCount} maaltijden actief`
      : 'Actieve maaltijden onbekend'

  return (
    <section className="budget-card" aria-labelledby="weekbudget-title">
      <div className="budget-heading">
        <div>
          <span className="eyebrow">Voorkeur · weekbudget</span>
          <strong id="weekbudget-title">{budgetLabel}</strong>
        </div>
        <PlannerBudgetStatusWithMinimum
          basketTotalCents={basketTotalCents}
          budgetEuros={budgetEuros}
          unresolvedLineCount={unresolvedLineCount}
        />
      </div>

      <div className="budget-options" aria-label="Kies je weekbudget">
        {presetBudgets.map((option) => (
          <button
            type="button"
            key={option}
            className={budgetEuros === option ? 'budget-chip active' : 'budget-chip'}
            aria-pressed={budgetEuros === option}
            onClick={() => onBudgetChange(option)}
          >
            {euro.formatCents(option * 100)}
          </button>
        ))}
      </div>

      <PlannerBudgetProgressCents
        basketTotalCents={basketTotalCents}
        budgetEuros={budgetEuros}
        unresolvedLineCount={unresolvedLineCount}
      />

      <div className="budget-summary">
        <span>{mealCountLabel}</span>
        <PlannerBasketSummaryCents
          basketTotalCents={basketTotalCents}
          budgetEuros={budgetEuros}
          unresolvedLineCount={unresolvedLineCount}
        />
      </div>

      <p className="disclaimer">
        {assessment.status === 'known'
          ? 'Dit bedrag komt uit dezelfde productmatching en verpakkingsberekening als de Mand-tab.'
          : unresolved
            ? `Nog ${assessment.unresolvedLineCount} ${assessment.unresolvedLineCount === 1 ? 'productmatch' : 'productmatches'} open. Dit is alleen het bekende minimum; het uiteindelijke mandbedrag kan hoger zijn.`
            : 'Budget en mandbedrag kunnen niet betrouwbaar worden berekend.'}
      </p>
    </section>
  )
}
