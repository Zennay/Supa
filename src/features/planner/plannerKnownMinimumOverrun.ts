/**
 * An incomplete basket's known product cost is a lower bound, not its total.
 * It may prove a minimum budget overrun, never an exact final overrun.
 *
 * Reject malformed, negative, fractional-cent and unsafe values rather than
 * borrowing confidence from a floating-point euro subtraction.
 */
export function plannerKnownMinimumOverrunCents({
  knownCostCents,
  budgetEuros,
  unresolvedLineCount,
}: {
  knownCostCents: unknown
  budgetEuros: unknown
  unresolvedLineCount: unknown
}): number | null {
  if (
    typeof knownCostCents !== 'number' ||
    !Number.isSafeInteger(knownCostCents) ||
    knownCostCents < 0 ||
    typeof budgetEuros !== 'number' ||
    !Number.isFinite(budgetEuros) ||
    budgetEuros < 0 ||
    typeof unresolvedLineCount !== 'number' ||
    !Number.isSafeInteger(unresolvedLineCount) ||
    unresolvedLineCount <= 0
  ) return null

  const budgetCents = Math.round(budgetEuros * 100)
  if (!Number.isSafeInteger(budgetCents) || budgetEuros !== budgetCents / 100) {
    return null
  }
  return knownCostCents > budgetCents ? knownCostCents - budgetCents : null
}
