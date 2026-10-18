import type { OneStoreBasket } from '../../domain/basket.ts'

export const shoppingListProgressStorageKey = 'supa:shopping-list-progress:v1'

type ShoppingListProgress = {
  schemaVersion: 1
  basketKey: string
  doneLineIds: string[]
}

const matchUnits = new Set(['g', 'kg', 'ml', 'l', 'piece', 'unknown'])
// A visible retailer ID and name are necessary even when a basket has rows.
// Never stamp checkmark identity for Unicode filler or direction-control text.
const hiddenStoreCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/u
function visibleStoreText(value: unknown): value is string {
  return typeof value === 'string' &&
    value === value.trim() &&
    !hiddenStoreCharacters.test(value) &&
    /[\p{L}\p{N}]/u.test(value)
}

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

/**
 * Persisted checkmarks must be bound to the basket's OWN observed facts,
 * never prototype fallbacks or accessor side effects. Descriptor reads also
 * avoid invoking a caller's getters (Proxy descriptor traps fail closed above).
 */
function ownFact(record: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field)
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined
}

function projectBasketLine(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const id = ownFact(value, 'id')
  const status = ownFact(value, 'status')
  const requirement = ownFact(value, 'requirement')
  if (!isNonBlankString(id) || !isRecord(requirement)) return null
  const amount = ownFact(requirement, 'amount')
  const unit = ownFact(requirement, 'unit')
  if (!isMatchUnit(unit)) return null

  if (status === 'unresolved') {
    if (amount !== null && typeof amount !== 'number') return null
    return {
      id,
      status,
      amount: amount === null ? null : numberForBasketKey(amount),
      unit,
    }
  }

  if (status !== 'matched') return null
  const productId = ownFact(value, 'productId')
  const packs = ownFact(value, 'packs')
  const pack = ownFact(value, 'pack')
  const pricePerPackCents = ownFact(value, 'pricePerPackCents')
  const lineTotalCents = ownFact(value, 'lineTotalCents')
  if (!isRecord(pack)) return null
  const packAmount = ownFact(pack, 'amount')
  const packUnit = ownFact(pack, 'unit')
  const packCount = ownFact(pack, 'count')
  if (
    !isPositiveFiniteNumber(amount) ||
    !isNonBlankString(productId) ||
    !isPositiveSafeInteger(packs) ||
    !isPositiveFiniteNumber(packAmount) ||
    !isMatchUnit(packUnit) ||
    !isPositiveSafeInteger(packCount) ||
    !isNonNegativeSafeInteger(pricePerPackCents) ||
    !isNonNegativeSafeInteger(lineTotalCents)
  ) return null

  // A checked identity must reflect a coherent physical price snapshot.
  // Reject overflow as well as mismatched cents; never coerce or recompute
  // caller-owned basket facts. Valid existing v1 keys remain byte-identical.
  const expectedLineTotalCents = packs * pricePerPackCents
  if (!Number.isSafeInteger(expectedLineTotalCents) ||
      lineTotalCents !== expectedLineTotalCents) return null

  return {
    id,
    status,
    amount,
    unit,
    productId,
    packs,
    packAmount,
    packUnit,
    packCount,
    pricePerPackCents,
    lineTotalCents,
  }
}

// Browser-restored baskets may include trapped getters or revoked Proxies.
// Treat any inaccessible runtime shape as invalid, never execute its error text
// through a UI-bound serialization or readiness path.
function shoppingListBasketState(basket: unknown): ShoppingListBasketState | null {
  try {
    return projectShoppingListBasketState(basket)
  } catch {
    return null
  }
}

function projectShoppingListBasketState(basket: unknown): ShoppingListBasketState | null {
  if (!isRecord(basket)) return null
  const store = ownFact(basket, 'store')
  const basketLines = ownFact(basket, 'lines')
  if (!isRecord(store) || !Array.isArray(basketLines)) return null
  const storeId = ownFact(store, 'id')
  const storeName = ownFact(store, 'name')
  if (!visibleStoreText(storeId) || !visibleStoreText(storeName)) return null

  const validIds = new Set<string>()
  const lines: Record<string, unknown>[] = []
  // Read only OWN dense elements, not values inherited from Array.prototype
  // or accessible via a caller's get trap.
  for (let index = 0; index < basketLines.length; index++) {
    const line = projectBasketLine(ownFact(basketLines, String(index)))
    if (!line || typeof line.id !== 'string' || validIds.has(line.id)) {
      return null
    }
    validIds.add(line.id)
    lines.push(line)
  }

  // The persistent v1 key deliberately stays the same for valid baskets.
  // The old implementation trusted only nested lines; root totals could lie,
  // allowing checkmarks or print/copy to survive a mismatched price ledger.
  const meals = ownFact(basket, 'selectedMealCount')
  const matchedCount = ownFact(basket, 'matchedLineCount')
  const unresolvedCount = ownFact(basket, 'unresolvedLineCount')
  const declaredTotal = ownFact(basket, 'totalCents')
  if (!isNonNegativeSafeInteger(meals) ||
      !isNonNegativeSafeInteger(matchedCount) ||
      !isNonNegativeSafeInteger(unresolvedCount) ||
      !isNonNegativeSafeInteger(declaredTotal) ||
      (lines.length > 0 && meals === 0) ||
      matchedCount + unresolvedCount !== lines.length) return null

  let actualMatched = 0
  let actualUnresolved = 0
  let actualCents = 0
  for (const line of lines) {
    if (line.status === 'unresolved') {
      actualUnresolved++
      continue
    }
    if (line.status !== 'matched' ||
        !isNonNegativeSafeInteger(line.lineTotalCents)) return null
    actualMatched++
    actualCents += line.lineTotalCents
    if (!Number.isSafeInteger(actualCents)) return null
  }
  if (actualMatched !== matchedCount ||
      actualUnresolved !== unresolvedCount ||
      actualCents !== declaredTotal) return null

  return {
    basketKey: JSON.stringify({ storeId, lines }),
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
