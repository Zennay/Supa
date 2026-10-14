import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'
import {
  restoreShoppingProgressV2,
  serializeShoppingProgressV2,
  toggleShoppingProgressV2,
  upgradeLegacyShoppingProgressV1,
} from './shoppingListProgressV2.ts'

/**
 * Render-independent orchestration for the eventual ShoppingListView v2 owner.
 * No browser storage is accessed here: the view owns the read/write lifecycle.
 * A pinned physical key avoids comparing two references to an in-place mutated
 * basket and inadvertently keeping stale checkmarks.
 */
export type ShoppingProgressSessionV2 = Readonly<{
  demandIdentity: string | null
  completedLineIds: readonly string[]
  serialized: string | null
  upgradedFromLegacy: boolean
}>

type LegacyUpgradeOption = Readonly<{
  /**
   * Explicit opt-in only. A present (even malformed) v2 snapshot takes
   * precedence; never fall back to v1 behind the owner's back.
   */
  allowLegacyUpgrade?: boolean
  rawV1?: string | null
}>

function makeSession(
  basket: OneStoreBasket,
  checked: readonly string[],
  upgradedFromLegacy = false,
): ShoppingProgressSessionV2 {
  const serialized = serializeShoppingProgressV2(basket, checked)
  if (serialized === null) {
    return {
      demandIdentity: null,
      completedLineIds: [],
      serialized: null,
      upgradedFromLegacy: false,
    }
  }

  return {
    demandIdentity: shoppingListDemandIdentity(basket),
    completedLineIds: [...JSON.parse(serialized).doneLineIds as string[]],
    serialized,
    upgradedFromLegacy,
  }
}

/** Restore v2 or, only by explicit opt-in when v2 is absent, a matching v1. */
export function startShoppingProgressSessionV2(
  basket: OneStoreBasket,
  rawV2: string | null,
  options: LegacyUpgradeOption = {},
): ShoppingProgressSessionV2 {
  let persisted = rawV2
  let upgraded = false
  if (rawV2 === null && options.allowLegacyUpgrade === true) {
    const converted = upgradeLegacyShoppingProgressV1(
      basket,
      options.rawV1 ?? null,
    )
    if (converted !== null) {
      persisted = converted
      upgraded = true
    }
  }

  return makeSession(basket, restoreShoppingProgressV2(basket, persisted), upgraded)
}

/**
 * Update on every new basket prop. Financial or display-only changes preserve
 * current ticks; store, demand, product, pack and resolved-status changes don't.
 * This compares pinned keys, not mutable old object references.
 */
export function rebaseShoppingProgressSessionV2(
  session: ShoppingProgressSessionV2,
  nextBasket: OneStoreBasket,
): ShoppingProgressSessionV2 {
  const newIdentity = shoppingListDemandIdentity(nextBasket)
  if (
    newIdentity === null ||
    session.demandIdentity === null ||
    session.demandIdentity !== newIdentity
  ) {
    return makeSession(nextBasket, [])
  }

  return makeSession(nextBasket, session.completedLineIds)
}

/** A toggle always verifies the current basket identity before committing. */
export function toggleShoppingProgressSessionV2(
  session: ShoppingProgressSessionV2,
  currentBasket: OneStoreBasket,
  lineId: unknown,
): ShoppingProgressSessionV2 {
  const rebased = rebaseShoppingProgressSessionV2(session, currentBasket)
  if (rebased.demandIdentity === null) return rebased
  return makeSession(
    currentBasket,
    toggleShoppingProgressV2(
      currentBasket,
      rebased.completedLineIds,
      lineId,
    ),
  )
}
