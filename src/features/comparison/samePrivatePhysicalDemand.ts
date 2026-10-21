import { calculateDecimalPackCount } from '../../domain/decimalPackArithmetic.ts'
import type { MatchUnit } from '../../domain/matching.ts'

type Demand = { amount: number | null; unit: string }

/**
 * Same physical demand, not the same textual unit. Mirrors the canonical
 * full-basket comparator's bidirectional exact-decimal rule: each physical
 * amount must cover the other in exactly one 'pack'. Incompatible families,
 * unknown values, zero and unsafe quantities cannot become a priced pair.
 */
export function samePrivatePhysicalDemand(left: Demand, right: Demand): boolean {
  if (!left || !right ||
      typeof left.amount !== 'number' || typeof right.amount !== 'number' ||
      !Number.isFinite(left.amount) || !Number.isFinite(right.amount) ||
      left.amount <= 0 || right.amount <= 0) return false
  if (left.unit === right.unit && left.amount === right.amount) {
    return ['g', 'kg', 'ml', 'l', 'piece'].includes(left.unit)
  }
  return calculateDecimalPackCount(
    [{ amount: left.amount, unit: left.unit as MatchUnit }],
    { amount: right.amount, unit: right.unit as MatchUnit },
  ) === 1 && calculateDecimalPackCount(
    [{ amount: right.amount, unit: right.unit as MatchUnit }],
    { amount: left.amount, unit: left.unit as MatchUnit },
  ) === 1
}
