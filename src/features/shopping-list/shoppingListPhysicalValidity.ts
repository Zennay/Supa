import type { OneStoreBasket } from '../../domain/basket.ts'

/**
 * Fail-closed physical and cent-integrity gate for a current shopping task.
 *
 * v2 task identity is deliberately price independent. This check is not an
 * identity: it verifies a basket is trustworthy before checked IDs can be
 * persisted/restored/toggled, without putting prices into the stable key.
 *
 * Isolated pre-integration module: #1058/#422 own existing v2/UI wiring.
 */
const REQUIREMENT_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece', 'unknown'])

type Family = 'mass' | 'volume' | 'piece'
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function quantity(value: unknown, unit: unknown): { value: number; family: Family } | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
      typeof unit !== 'string') return null

  let family: Family
  let factor = 1
  if (unit === 'g' || unit === 'kg') {
    family = 'mass'
    factor = unit === 'kg' ? 1000 : 1
  } else if (unit === 'ml' || unit === 'l') {
    family = 'volume'
    factor = unit === 'l' ? 1000 : 1
  } else if (unit === 'piece') {
    family = 'piece'
  } else {
    return null
  }

  const base = value * factor
  return Number.isFinite(base) && base > 0 ? { value: base, family } : null
}

function safeNonnegativeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Checks the actual current basket, including its selected demands and
 * minimum physical packs. Does not guess from a previously saved basket key.
 * Returns false on any malformed/inconsistent input, never throws.
 *
 * The quotient intentionally does not apply an epsilon: a genuinely larger
 * already-aggregated demand must not be treated as an exact fit. Upstream
 * fractional ingredient aggregation (#1053) remains separately owned.
 */
export function isTrustworthyShoppingBasket(basket: unknown): basket is OneStoreBasket {
  if (!record(basket) || !record(basket.store) ||
      !identifier(basket.store.id) || !Array.isArray(basket.lines) ||
      basket.lines.length > 10000 ||
      !safeNonnegativeCents(basket.totalCents) ||
      !safeNonnegativeCents(basket.selectedMealCount) ||
      !safeNonnegativeCents(basket.matchedLineCount) ||
      !safeNonnegativeCents(basket.unresolvedLineCount) ||
      (basket.selectedMealCount === 0 && basket.lines.length !== 0) ||
      basket.matchedLineCount + basket.unresolvedLineCount !== basket.lines.length
  ) return false

  const seen = new Set<string>()
  let matched = 0
  let unresolved = 0
  let summedCents = 0

  for (const value of basket.lines) {
    if (!record(value) || !identifier(value.id) || seen.has(value.id) ||
        !record(value.requirement) ||
        typeof value.requirement.unit !== 'string' ||
        !REQUIREMENT_UNITS.has(value.requirement.unit)) return false

    seen.add(value.id)

    if (value.status === 'unresolved') {
      if (value.requirement.amount !== null &&
          quantity(value.requirement.amount, value.requirement.unit) === null) return false
      unresolved++
      continue
    }
    if (value.status !== 'matched' || !identifier(value.productId) ||
        !identifier(value.productName) || !record(value.pack) ||
        !safeCount(value.pack.count) || !safeCount(value.packs) ||
        !safeNonnegativeCents(value.pricePerPackCents) ||
        !safeNonnegativeCents(value.lineTotalCents)) return false

    const required = quantity(value.requirement.amount, value.requirement.unit)
    const packageQuantity = quantity(value.pack.amount, value.pack.unit)
    if (!required || !packageQuantity || required.family !== packageQuantity.family) return false

    const effective = packageQuantity.value * value.pack.count
    if (!Number.isFinite(effective) || effective <= 0) return false

    const minimumPacks = Math.ceil(required.value / effective)
    if (!safeCount(minimumPacks) || minimumPacks !== value.packs ||
        value.packs * value.pricePerPackCents !== value.lineTotalCents) return false

    summedCents += value.lineTotalCents
    if (!Number.isSafeInteger(summedCents)) return false
    matched++
  }

  return matched === basket.matchedLineCount &&
    unresolved === basket.unresolvedLineCount &&
    summedCents === basket.totalCents
}
