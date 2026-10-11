import { euro } from './money.ts'

export type PlannerCentBudgetAssessment =
  | {
      status: 'known'
      budgetCents: number
      plannedCostCents: number
      remainingCents: number
      overBudget: boolean
      usage: number
      remainingLabel: string
    }
  | {
      status: 'unknown'
      reason: 'invalid-input' | 'unresolved-products'
      budgetCents: number | null
      knownMinimumCents: number | null
      unresolvedLineCount: number | null
    }

function exactCentsFromEuros(euros: unknown): number | null {
  if (typeof euros !== 'number' || !Number.isFinite(euros) || euros < 0) {
    return null
  }

  const cents = Math.round(euros * 100)
  return Number.isSafeInteger(cents) && euros === cents / 100
    ? cents
    : null
}

/**
 * Calculate a planner budget from integer-cent basket evidence.
 *
 * This is a product-core adapter for a future coordinated PlannerView landing:
 * avoid subtracting floating-point euro values and then asking the strict
 * monetary formatter to display the rounded result.
 *
 * An incomplete basket may expose a known minimum but never a remaining
 * budget or an "under budget" claim. Malformed evidence exposes no money.
 */
export function assessPlannerBudgetCents(
  basketTotalCents: unknown,
  budgetEuros: unknown,
  unresolvedLineCount: unknown,
): PlannerCentBudgetAssessment {
  const budgetCents = exactCentsFromEuros(budgetEuros)
  const validCost =
    typeof basketTotalCents === 'number' &&
    Number.isSafeInteger(basketTotalCents) &&
    basketTotalCents >= 0
  const validUnresolved =
    typeof unresolvedLineCount === 'number' &&
    Number.isSafeInteger(unresolvedLineCount) &&
    unresolvedLineCount >= 0

  if (budgetCents === null || !validCost || !validUnresolved) {
    return {
      status: 'unknown',
      reason: 'invalid-input',
      budgetCents: null,
      knownMinimumCents: null,
      unresolvedLineCount: null,
    }
  }

  if (unresolvedLineCount > 0) {
    return {
      status: 'unknown',
      reason: 'unresolved-products',
      budgetCents,
      knownMinimumCents: basketTotalCents,
      unresolvedLineCount,
    }
  }

  const remainingCents = budgetCents - basketTotalCents
  return {
    status: 'known',
    budgetCents,
    plannedCostCents: basketTotalCents,
    remainingCents,
    overBudget: remainingCents < 0,
    usage:
      budgetCents === 0
        ? 1
        : Math.min(basketTotalCents / budgetCents, 1),
    remainingLabel: euro.formatCents(remainingCents),
  }
}
