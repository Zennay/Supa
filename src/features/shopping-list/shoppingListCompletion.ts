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

function reviewMessage(count: number): string {
  return count === 1
    ? '1 productkeuze vraagt nog jouw controle.'
    : `${count} productkeuzes vragen nog jouw controle.`
}

type PhysicalFamily = 'mass' | 'volume' | 'piece'

/**
 * Mirror the basket builder's base-unit conversion and pack arithmetic.
 * Treat incomparable units, overflow and stale pack counts as untrusted.
 */
function baseQuantity(
  amount: number,
  unit: string,
): { amount: number; family: PhysicalFamily } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null

  let scaled: number
  let family: PhysicalFamily
  if (unit === 'g' || unit === 'kg') {
    family = 'mass'
    scaled = unit === 'kg' ? amount * 1000 : amount
  } else if (unit === 'ml' || unit === 'l') {
    family = 'volume'
    scaled = unit === 'l' ? amount * 1000 : amount
  } else if (unit === 'piece') {
    family = 'piece'
    scaled = amount
  } else {
    return null
  }

  return Number.isFinite(scaled) && scaled > 0 ? { amount: scaled, family } : null
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
    !Number.isSafeInteger(basket.totalCents) ||
    basket.totalCents < 0 ||
    !Number.isSafeInteger(basket.selectedMealCount) ||
    basket.selectedMealCount < 0 ||
    !Number.isSafeInteger(basket.matchedLineCount) ||
    !Number.isSafeInteger(basket.unresolvedLineCount) ||
    basket.matchedLineCount < 0 ||
    basket.unresolvedLineCount < 0 ||
    (basket.selectedMealCount === 0 && lines.length > 0) ||
    basket.matchedLineCount + basket.unresolvedLineCount !== lines.length
  ) {
    return { ...invalid }
  }

  const ids = new Set<string>()
  let matched = 0
  let unresolved = 0
  let verifiedTotalCents = 0

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
    // Exact physical coverage: a valid integer pack count must be the
    // same minimum quantity the canonical basket builder would purchase.
    const required = baseQuantity(line.requirement.amount, line.requirement.unit)
    const effectivePackAmount = line.pack.amount * line.pack.count
    const supplied = baseQuantity(effectivePackAmount, line.pack.unit)
    if (
      !required ||
      !supplied ||
      required.family !== supplied.family ||
      !Number.isSafeInteger(Math.ceil(required.amount / supplied.amount)) ||
      Math.ceil(required.amount / supplied.amount) !== line.packs
    ) {
      return { ...invalid }
    }

    // A row can have consistent line arithmetic while the basket total is
    // stale. Reconcile against all matched lines, not only checked rows.
    verifiedTotalCents += line.lineTotalCents
    if (!Number.isSafeInteger(verifiedTotalCents)) return { ...invalid }
    matched += 1
  }

  if (
    matched !== basket.matchedLineCount ||
    unresolved !== basket.unresolvedLineCount ||
    verifiedTotalCents !== basket.totalCents
  ) {
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
