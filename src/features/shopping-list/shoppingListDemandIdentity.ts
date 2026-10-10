import type { OneStoreBasket } from '../../domain/basket.ts'
import { isPhysicallyTrustworthyShoppingBasket } from './shoppingListPhysicalValidity.ts'

/**
 * Stable, price-independent identity for the physical shopping task.
 *
 * A new price observation must not uncheck groceries already in the trolley.
 * A different shop, ingredient quantity, match outcome, product or pack must
 * invalidate those checkmarks. This intentionally does not read basket prices.
 *
 * This is a v2 *building block*, not a persistence-format migration: the
 * existing v1 key and stored records must not be silently reinterpreted.
 */
const MATCH_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece', 'unknown'])
const PACK_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function amount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function wholePacks(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Return null for an invalid runtime basket; consumers must never store or
 * restore checked items under a null identity.
 */
export function shoppingListDemandIdentity(basket: OneStoreBasket): string | null {
  // A price-independent key must still represent a possible physical task.
  // Monetary integrity is enforced separately by trusted v2 storage entry points.
  if (!isPhysicallyTrustworthyShoppingBasket(basket)) return null
  const input = record(basket)
  const store = record(input?.store)
  if (!store || !identifier(store.id) || !Array.isArray(input?.lines)) {
    return null
  }

  const seen = new Set<string>()
  const lines: Array<Record<string, unknown>> = []

  for (const value of input.lines) {
    const line = record(value)
    const requirement = record(line?.requirement)

    if (
      !line ||
      !identifier(line.id) ||
      seen.has(line.id) ||
      !requirement ||
      typeof requirement.unit !== 'string' ||
      !MATCH_UNITS.has(requirement.unit) ||
      (requirement.amount !== null && !amount(requirement.amount))
    ) {
      return null
    }

    seen.add(line.id)

    if (line.status === 'unresolved') {
      lines.push({
        id: line.id,
        status: 'unresolved',
        amount: requirement.amount,
        unit: requirement.unit,
      })
      continue
    }

    if (line.status !== 'matched') return null
    const pack = record(line.pack)
    if (
      !amount(requirement.amount) ||
      requirement.unit === 'unknown' ||
      !identifier(line.productId) ||
      !wholePacks(line.packs) ||
      !pack ||
      !amount(pack.amount) ||
      typeof pack.unit !== 'string' ||
      !PACK_UNITS.has(pack.unit) ||
      !wholePacks(pack.count)
    ) {
      return null
    }

    lines.push({
      id: line.id,
      status: 'matched',
      amount: requirement.amount,
      unit: requirement.unit,
      productId: line.productId,
      packs: line.packs,
      packAmount: pack.amount,
      packUnit: pack.unit,
      packCount: pack.count,
    })
  }

  // Reordering the presentation does not change what must be purchased.
  // Use code-point order rather than locale-sensitive ordering for stable keys.
  lines.sort((left, right) => {
    const a = String(left.id)
    const b = String(right.id)
    return a < b ? -1 : a > b ? 1 : 0
  })

  return JSON.stringify({ schemaVersion: 2, storeId: store.id, lines })
}
