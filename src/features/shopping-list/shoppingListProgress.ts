import type { OneStoreBasket } from '../../domain/basket.ts'

export const shoppingListProgressStorageKey = 'supa:shopping-list-progress:v1'

type ShoppingListProgress = {
  schemaVersion: 1
  basketKey: string
  doneLineIds: string[]
}

export function shoppingListBasketKey(basket: OneStoreBasket): string {
  return JSON.stringify({
    storeId: basket.store.id,
    lines: basket.lines.map((line) =>
      line.status === 'matched'
        ? {
            id: line.id,
            status: line.status,
            amount: line.requirement.amount,
            unit: line.requirement.unit,
            productId: line.productId,
            packs: line.packs,
            lineTotalCents: line.lineTotalCents,
          }
        : {
            id: line.id,
            status: line.status,
            amount: line.requirement.amount,
            unit: line.requirement.unit,
          },
    ),
  })
}

export function restoreShoppingListProgress(
  basket: OneStoreBasket,
  raw: string | null,
): string[] {
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []

    const candidate = parsed as Partial<ShoppingListProgress>
    if (
      candidate.schemaVersion !== 1 ||
      candidate.basketKey !== shoppingListBasketKey(basket) ||
      !Array.isArray(candidate.doneLineIds)
    ) {
      return []
    }

    const validIds = new Set(basket.lines.map((line) => line.id))
    return Array.from(
      new Set(
        candidate.doneLineIds.filter(
          (id): id is string => typeof id === 'string' && validIds.has(id),
        ),
      ),
    )
  } catch {
    return []
  }
}

export function serializeShoppingListProgress(
  basket: OneStoreBasket,
  doneLineIds: string[],
): string {
  const validIds = new Set(basket.lines.map((line) => line.id))
  const safeDoneLineIds = Array.from(
    new Set(doneLineIds.filter((id) => validIds.has(id))),
  )

  return JSON.stringify({
    schemaVersion: 1,
    basketKey: shoppingListBasketKey(basket),
    doneLineIds: safeDoneLineIds,
  } satisfies ShoppingListProgress)
}
