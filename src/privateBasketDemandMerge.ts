/**
 * Same-screen, human-requested exact physical aggregation.
 * Uses the existing production decimal domain, never guesses SKU equivalence.
 */
import { sumDecimalDemandUnits } from './domain/decimalPackArithmetic.ts'
import type { MatchUnit } from './domain/matching.ts'

type MergeRequest = {
  quantities: { amount: number; unit: MatchUnit }[]
  resultUnit: MatchUnit
  result: number | null
}
document.addEventListener('supa:sum-private-demand', (event: Event) => {
  const value = (event as CustomEvent<MergeRequest>).detail
  if (!value || !Array.isArray(value.quantities) || value.quantities.length < 2 ||
      value.quantities.length > 200 || !['g', 'kg', 'ml', 'l', 'piece'].includes(value.resultUnit)) {
    return
  }
  value.result = sumDecimalDemandUnits(value.quantities, value.resultUnit)
})
