import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'
import { restoreShoppingListProgress, shoppingListBasketKey } from './shoppingListProgress.ts'

/**
 * A separate namespace intentionally prevents v1 price-dependent snapshots
 * from being accepted as v2 physical-shopping snapshots.
 */
export const shoppingListProgressV2StorageKey = 'supa:shopping-list-progress:v2'

type ShoppingProgressV2 = {
  schemaVersion: 2
  demandIdentity: string
  doneLineIds: string[]
}

function checkedIds(basket: OneStoreBasket, values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const valid = new Set(basket.lines.map((line) => line.id))
  return Array.from(new Set(values.filter(
    (value): value is string => typeof value === 'string' && valid.has(value),
  )))
}

/**
 * The caller must not write a null result to storage. Invalid basket shapes
 * produce no persisted progress.
 */
export function serializeShoppingProgressV2(
  basket: OneStoreBasket,
  doneLineIds: unknown,
): string | null {
  const demandIdentity = shoppingListDemandIdentity(basket)
  if (demandIdentity === null) return null

  return JSON.stringify({
    schemaVersion: 2,
    demandIdentity,
    doneLineIds: checkedIds(basket, doneLineIds),
  } satisfies ShoppingProgressV2)
}

export function restoreShoppingProgressV2(
  basket: OneStoreBasket,
  raw: string | null,
): string[] {
  const currentIdentity = shoppingListDemandIdentity(basket)
  if (currentIdentity === null || !raw) return []

  try {
    const candidate: unknown = JSON.parse(raw)
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return []
    }

    const item = candidate as Partial<ShoppingProgressV2>
    if (
      item.schemaVersion !== 2 ||
      item.demandIdentity !== currentIdentity ||
      !Array.isArray(item.doneLineIds)
    ) {
      return []
    }

    return checkedIds(basket, item.doneLineIds)
  } catch {
    return []
  }
}

/**
 * Same-session state transition. Preserve completion for a purely financial
 * or presentation update; drop it for any changed physical shopping demand.
 */
export function reconcileShoppingProgressV2(
  previousBasket: OneStoreBasket,
  nextBasket: OneStoreBasket,
  completedLineIds: unknown,
): string[] {
  const previous = shoppingListDemandIdentity(previousBasket)
  if (previous === null || previous !== shoppingListDemandIdentity(nextBasket)) {
    return []
  }
  return checkedIds(nextBasket, completedLineIds)
}

/**
 * Safe toggle boundary for the future ShoppingListView integration.
 * Unknown line ids, malformed baskets and invalid caller input fail closed:
 * they can neither add phantom checks nor resurrect an old shopping task.
 */
export function toggleShoppingProgressV2(
  basket: OneStoreBasket,
  completedLineIds: unknown,
  lineId: unknown,
): string[] {
  if (shoppingListDemandIdentity(basket) === null) return []
  const validCompleted = checkedIds(basket, completedLineIds)
  if (typeof lineId !== 'string' || !basket.lines.some((line) => line.id === lineId)) {
    return validCompleted
  }
  return validCompleted.includes(lineId)
    ? validCompleted.filter((id) => id !== lineId)
    : [...validCompleted, lineId]
}

/**
 * Explicit, opt-in upgrade from the legacy price-dependent v1 storage.
 *
 * Only a byte-for-byte identical legacy basket key can prove that the
 * previously checked products and prices still describe this purchase task.
 * A stale v1 price observation must NEVER be inferred equivalent under v2.
 * The view owner decides whether/when to call this once, then persists the
 * returned record under the separate v2 storage key.
 */
export function upgradeLegacyShoppingProgressV1(
  basket: OneStoreBasket,
  rawV1: string | null,
): string | null {
  if (shoppingListDemandIdentity(basket) === null || !rawV1) return null

  try {
    const parsed: unknown = JSON.parse(rawV1)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const candidate = parsed as Record<string, unknown>
    if (
      candidate.schemaVersion !== 1 ||
      !Array.isArray(candidate.doneLineIds) ||
      candidate.basketKey !== shoppingListBasketKey(basket)
    ) {
      return null
    }

    const validDone = restoreShoppingListProgress(basket, rawV1)
    return serializeShoppingProgressV2(basket, validDone)
  } catch {
    return null
  }
}
