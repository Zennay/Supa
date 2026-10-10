import type { OneStoreBasket } from '../../domain/basket.ts'
import { isTrustworthyShoppingBasket } from './shoppingListPhysicalValidity.ts'
import {
  reconcileShoppingProgressV2,
  restoreShoppingProgressV2,
  serializeShoppingProgressV2,
  toggleShoppingProgressV2,
  upgradeLegacyShoppingProgressV1,
} from './shoppingListProgressV2.ts'

/**
 * Opt-in pre-integration boundary for #1056/#1091.
 *
 * Reuse the owner's price-stable v2 identity and migration contract while
 * rejecting invalid physical/money snapshots *before* any checked status can
 * enter or leave local storage. ShoppingListView is not changed here.
 */
export function serializeTrustedShoppingProgressV2(
  basket: OneStoreBasket, doneLineIds: unknown,
): string | null {
  return isTrustworthyShoppingBasket(basket)
    ? serializeShoppingProgressV2(basket, doneLineIds)
    : null
}

export function restoreTrustedShoppingProgressV2(
  basket: OneStoreBasket, raw: string | null,
): string[] {
  return isTrustworthyShoppingBasket(basket)
    ? restoreShoppingProgressV2(basket, raw)
    : []
}

export function reconcileTrustedShoppingProgressV2(
  previousBasket: OneStoreBasket, nextBasket: OneStoreBasket,
  doneLineIds: unknown,
): string[] {
  return isTrustworthyShoppingBasket(previousBasket) &&
    isTrustworthyShoppingBasket(nextBasket)
    ? reconcileShoppingProgressV2(previousBasket, nextBasket, doneLineIds)
    : []
}

export function toggleTrustedShoppingProgressV2(
  basket: OneStoreBasket, doneLineIds: unknown, lineId: unknown,
): string[] {
  return isTrustworthyShoppingBasket(basket)
    ? toggleShoppingProgressV2(basket, doneLineIds, lineId)
    : []
}

export function upgradeTrustedLegacyProgressV1(
  basket: OneStoreBasket, rawV1: string | null,
): string | null {
  return isTrustworthyShoppingBasket(basket)
    ? upgradeLegacyShoppingProgressV1(basket, rawV1)
    : null
}
