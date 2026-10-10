import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'

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
