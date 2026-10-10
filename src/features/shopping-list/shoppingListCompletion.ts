import type { OneStoreBasket } from '../../domain/basket.ts'

export type ShoppingListCompletion = {
  state: 'empty' | 'in-progress' | 'complete' | 'review-needed' | 'invalid'
  checkedCount: number
  totalCount: number
  remainingCount: number
  unresolvedCount: number
  message: string
  followUp: string | null
}

const invalid: ShoppingListCompletion = {
  state: 'invalid',
  checkedCount: 0,
  totalCount: 0,
  remainingCount: 0,
  unresolvedCount: 0,
  message: 'Voortgang niet beschikbaar',
  followUp: 'Controleer de actuele boodschappenlijst voordat je verdergaat.',
}

type QuantityFamily = 'mass' | 'volume' | 'piece'

/** Same base-unit / whole-pack contract used by the one-store basket engine. */
function physicalAmount(value: unknown, unit: unknown): { amount: number; family: QuantityFamily } | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  let family: QuantityFamily
  let factor = 1
  if (unit === 'g' || unit === 'kg') {
    family = 'mass'
    if (unit === 'kg') factor = 1000
  } else if (unit === 'ml' || unit === 'l') {
    family = 'volume'
    if (unit === 'l') factor = 1000
  } else if (unit === 'piece') {
    family = 'piece'
  } else {
    return null
  }
  const amount = value * factor
  return Number.isFinite(amount) && amount > 0 ? { amount, family } : null
}

function reviewMessage(count: number): string {
  return count === 1
    ? '1 productkeuze vraagt nog jouw controle.'
    : `${count} productkeuzes vragen nog jouw controle.`
}

/**
 * Derive shopping progress exclusively from the current basket and current
 * checked IDs. Checking an unresolved row is not proof of a product match.
 *
 * This is presentation state, not evidence of prices, purchases or savings.
 * Never persist or reconcile the IDs here: the shopping-list owner controls
 * basket identity, v1/v2 migration and storage.
 */
export function shoppingListCompletion(
  basket: OneStoreBasket,
  doneLineIds: unknown,
): ShoppingListCompletion {
  if (!basket || typeof basket !== 'object' || !Array.isArray(basket.lines)) {
    return { ...invalid }
  }

  const { lines } = basket
  if (
    !Number.isSafeInteger(basket.selectedMealCount) ||
    basket.selectedMealCount < 0 ||
    !Number.isSafeInteger(basket.matchedLineCount) ||
    !Number.isSafeInteger(basket.unresolvedLineCount) ||
    basket.matchedLineCount < 0 ||
    basket.unresolvedLineCount < 0 ||
    !Number.isSafeInteger(basket.totalCents) || basket.totalCents < 0 ||
    (basket.selectedMealCount === 0 && lines.length > 0) ||
    basket.matchedLineCount + basket.unresolvedLineCount !== lines.length
  ) {
    return { ...invalid }
  }

  const ids = new Set<string>()
  let matched = 0
  let unresolved = 0
  let summedCents = 0

  for (const line of lines) {
    if (
      !line ||
      typeof line !== 'object' ||
      typeof line.id !== 'string' ||
      !line.id.trim() ||
      ids.has(line.id)
    ) {
      return { ...invalid }
    }
    ids.add(line.id)

    if (line.status === 'unresolved') {
      unresolved += 1
      continue
    }
    if (
      line.status !== 'matched' ||
      typeof line.productId !== 'string' ||
      !line.productId.trim() ||
      typeof line.productName !== 'string' ||
      !line.productName.trim() ||
      !Number.isFinite(line.requirement?.amount) ||
      line.requirement.amount <= 0 ||
      !Number.isFinite(line.pack?.amount) ||
      line.pack.amount <= 0 ||
      !['g', 'kg', 'ml', 'l', 'piece'].includes(line.requirement.unit) ||
      !['g', 'kg', 'ml', 'l', 'piece'].includes(line.pack.unit) ||
      !Number.isSafeInteger(line.packs) ||
      line.packs < 1 ||
      !Number.isSafeInteger(line.pack?.count) ||
      line.pack.count < 1 ||
      !Number.isSafeInteger(line.pricePerPackCents) ||
      line.pricePerPackCents < 0 ||
      !Number.isSafeInteger(line.lineTotalCents) ||
      line.lineTotalCents < 0 ||
      line.lineTotalCents !== line.packs * line.pricePerPackCents
    ) {
      return { ...invalid }
    }
    // Checkbox completion is only trustworthy if this exact number of packs
    // covers the demand with a compatible physical unit family.
    const demanded = physicalAmount(line.requirement.amount, line.requirement.unit)
    const packaged = physicalAmount(line.pack.amount, line.pack.unit)
    if (!demanded || !packaged || demanded.family !== packaged.family) {
      return { ...invalid }
    }
    const effectivePackAmount = packaged.amount * line.pack.count
    const minimumWholePacks = Math.ceil(demanded.amount / effectivePackAmount)
    if (!Number.isFinite(effectivePackAmount) || effectivePackAmount <= 0 ||
        !Number.isSafeInteger(minimumWholePacks) || minimumWholePacks < 1 ||
        minimumWholePacks !== line.packs) {
      return { ...invalid }
    }
    summedCents += line.lineTotalCents
    if (!Number.isSafeInteger(summedCents)) return { ...invalid }
    matched += 1
  }

  if (summedCents !== basket.totalCents ||
      matched !== basket.matchedLineCount || unresolved !== basket.unresolvedLineCount) {
    return { ...invalid }
  }

  const checkedIds = new Set(
    Array.isArray(doneLineIds)
      ? doneLineIds.filter((id): id is string => typeof id === 'string' && ids.has(id))
      : [],
  )
  const checkedCount = checkedIds.size
  const totalCount = lines.length
  const remainingCount = totalCount - checkedCount

  if (totalCount === 0) {
    return {
      state: 'empty',
      checkedCount: 0,
      totalCount: 0,
      remainingCount: 0,
      unresolvedCount: 0,
      message: 'Geen boodschappenregels voor deze planning.',
      followUp: null,
    }
  }

  if (remainingCount > 0) {
    return {
      state: 'in-progress',
      checkedCount,
      totalCount,
      remainingCount,
      unresolvedCount: unresolved,
      message: `${checkedCount} van ${totalCount} ${totalCount === 1 ? 'boodschap' : 'boodschappen'} afgevinkt.`,
      followUp: unresolved > 0 ? reviewMessage(unresolved) : null,
    }
  }

  if (unresolved > 0) {
    return {
      state: 'review-needed',
      checkedCount,
      totalCount,
      remainingCount: 0,
      unresolvedCount: unresolved,
      message: 'Alles afgevinkt, maar nog niet klaar.',
      followUp: reviewMessage(unresolved),
    }
  }

  return {
    state: 'complete',
    checkedCount,
    totalCount,
    remainingCount: 0,
    unresolvedCount: 0,
    message: 'Alle boodschappen afgevinkt.',
    followUp: null,
  }
}
