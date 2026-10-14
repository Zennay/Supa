import type { OneStoreBasket } from '../../domain/basket.ts'

export const shoppingListProgressStorageKey = 'supa:shopping-list-progress:v1'

type ShoppingListProgress = {
  schemaVersion: 1
  basketKey: string
  doneLineIds: string[]
}

const matchUnits = new Set(['g', 'kg', 'ml', 'l', 'piece', 'unknown'])

type ShoppingListBasketState = {
  basketKey: string
  validIds: Set<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMatchUnit(value: unknown): value is string {
  return typeof value === 'string' && matchUnits.has(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  )
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  )
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function numberForBasketKey(value: number): number | string {
  if (Number.isNaN(value)) return '__supa_number__:nan'
  if (value === Number.POSITIVE_INFINITY) return '__supa_number__:positive_infinity'
  if (value === Number.NEGATIVE_INFINITY) return '__supa_number__:negative_infinity'
  if (Object.is(value, -0)) return '__supa_number__:negative_zero'
  return value
}

function projectBasketLine(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isNonBlankString(value.id)) return null
  if (!isRecord(value.requirement) || !isMatchUnit(value.requirement.unit)) {
    return null
  }

  if (value.status === 'unresolved') {
    if (
      value.requirement.amount !== null &&
      typeof value.requirement.amount !== 'number'
    ) {
      return null
    }

    return {
      id: value.id,
      status: value.status,
      amount:
        value.requirement.amount === null
          ? null
          : numberForBasketKey(value.requirement.amount),
      unit: value.requirement.unit,
    }
  }

  if (value.status !== 'matched') return null
  if (
    !isPositiveFiniteNumber(value.requirement.amount) ||
    !isNonBlankString(value.productId) ||
    !isPositiveSafeInteger(value.packs) ||
    !isRecord(value.pack) ||
    !isPositiveFiniteNumber(value.pack.amount) ||
    !isMatchUnit(value.pack.unit) ||
    !isPositiveSafeInteger(value.pack.count) ||
    !isNonNegativeSafeInteger(value.pricePerPackCents) ||
    !isNonNegativeSafeInteger(value.lineTotalCents)
  ) {
    return null
  }

  return {
    id: value.id,
    status: value.status,
    amount: value.requirement.amount,
    unit: value.requirement.unit,
    productId: value.productId,
    packs: value.packs,
    packAmount: value.pack.amount,
    packUnit: value.pack.unit,
    packCount: value.pack.count,
    pricePerPackCents: value.pricePerPackCents,
    lineTotalCents: value.lineTotalCents,
  }
}

function shoppingListBasketState(basket: unknown): ShoppingListBasketState | null {
  if (
    !isRecord(basket) ||
    !isRecord(basket.store) ||
    !isNonBlankString(basket.store.id) ||
    !Array.isArray(basket.lines)
  ) {
    return null
  }

  const validIds = new Set<string>()
  const lines: Record<string, unknown>[] = []

  for (const value of basket.lines) {
    const line = projectBasketLine(value)
    if (!line || typeof line.id !== 'string' || validIds.has(line.id)) {
      return null
    }

    validIds.add(line.id)
    lines.push(line)
  }

  return {
    basketKey: JSON.stringify({
      storeId: basket.store.id,
      lines,
    }),
    validIds,
  }
}

export function shoppingListBasketKey(basket: OneStoreBasket): string {
  const state = shoppingListBasketState(basket)
  if (!state) {
    throw new Error('Invalid shopping list basket runtime shape')
  }

  return state.basketKey
}

export function restoreShoppingListProgress(
  basket: OneStoreBasket,
  raw: string | null,
): string[] {
  if (!raw) return []

  try {
    const basketState = shoppingListBasketState(basket)
    if (!basketState) return []

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []

    const candidate = parsed as Partial<ShoppingListProgress>
    if (
      candidate.schemaVersion !== 1 ||
      candidate.basketKey !== basketState.basketKey ||
      !Array.isArray(candidate.doneLineIds)
    ) {
      return []
    }

    return Array.from(
      new Set(
        candidate.doneLineIds.filter(
          (id): id is string =>
            typeof id === 'string' && basketState.validIds.has(id),
        ),
      ),
    )
  } catch {
    return []
  }
}

export function serializeShoppingListProgress(
  basket: OneStoreBasket,
  doneLineIds: unknown,
): string {
  const basketState = shoppingListBasketState(basket)
  if (!basketState) {
    throw new Error('Invalid shopping list basket runtime shape')
  }

  const runtimeDoneLineIds = Array.isArray(doneLineIds) ? doneLineIds : []
  const safeDoneLineIds = Array.from(
    new Set(
      runtimeDoneLineIds.filter(
        (id): id is string =>
          typeof id === 'string' && basketState.validIds.has(id),
      ),
    ),
  )

  return JSON.stringify({
    schemaVersion: 1,
    basketKey: basketState.basketKey,
    doneLineIds: safeDoneLineIds,
  } satisfies ShoppingListProgress)
}
