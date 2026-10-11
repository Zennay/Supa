import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'
import { shoppingListProgressStorageKey } from './shoppingListProgress.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey } from './shoppingListProgressV2.ts'
import {
  rebaseShoppingProgressSessionV2,
  startShoppingProgressSessionV2,
  toggleShoppingProgressSessionV2,
  type ShoppingProgressSessionV2,
} from './shoppingListProgressSessionV2.ts'

type ShoppingStoragePort = Readonly<{
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}>

type StorageOptions = Readonly<{
  /** Never inferred. Legacy v1 can only be migrated with explicit permission. */
  allowLegacyUpgrade?: boolean
}>

/**
 * No localStorage access at module import time; the UI owns initialization.
 * Opening a controller reads storage but does not write (safe for render).
 * In strict/private-browser contexts a throwing storage port safely degrades
 * to an in-memory checklist without an implicit fallback to legacy storage.
 */
export function openShoppingProgressStorageV2(
  basket: OneStoreBasket,
  storage: ShoppingStoragePort | null,
  options: StorageOptions = {},
) {
  let storageReadable = false
  let initialV2: string | null = null
  let initialV1: string | null = null

  if (storage !== null) {
    try {
      initialV2 = storage.getItem(shoppingListProgressV2StorageKey)
      storageReadable = true
      if (initialV2 === null && options.allowLegacyUpgrade === true) {
        initialV1 = storage.getItem(shoppingListProgressStorageKey)
      }
    } catch {
      // Do not trust partial storage reads or turn a failure into migration.
      storageReadable = false
      initialV2 = null
      initialV1 = null
    }
  }

  let currentBasket = basket
  let session = startShoppingProgressSessionV2(
    basket,
    storageReadable ? initialV2 : null,
    {
      allowLegacyUpgrade: storageReadable && options.allowLegacyUpgrade === true,
      rawV1: initialV1,
    },
  )

  let clearedRound: { demandIdentity: string; completedLineIds: readonly string[] } | null = null

  const snapshot = (): ShoppingProgressSessionV2 => ({
    ...session,
    completedLineIds: [...session.completedLineIds],
  })

  return {
    snapshot,

    rebase(nextBasket: OneStoreBasket): ShoppingProgressSessionV2 {
      session = rebaseShoppingProgressSessionV2(session, nextBasket)
      currentBasket = nextBasket
      // Undo belongs to this exact physical shopping round only.
      if (clearedRound?.demandIdentity !== session.demandIdentity) clearedRound = null
      return snapshot()
    },

    toggle(lineId: unknown): ShoppingProgressSessionV2 {
      // Any subsequent manual edit ends the one-step undo window.
      clearedRound = null
      session = toggleShoppingProgressSessionV2(session, currentBasket, lineId)
      return snapshot()
    },

    /**
     * Only a deliberate user action should call this. Restarting the current
     * shopping round writes an empty v2 completion snapshot after the caller
     * explicitly invokes persist(); the legacy v1 key remains untouched.
     */
    clear(): ShoppingProgressSessionV2 {
      const before = snapshot()
      session = startShoppingProgressSessionV2(currentBasket, null)
      clearedRound =
        before.demandIdentity !== null &&
        before.demandIdentity === session.demandIdentity &&
        before.completedLineIds.length > 0
          ? { demandIdentity: before.demandIdentity, completedLineIds: before.completedLineIds }
          : null
      return snapshot()
    },

    /** The undo offer must never survive any physical-demand change or new tick. */
    canUndoClear(): boolean {
      return (
        clearedRound !== null &&
        session.demandIdentity === clearedRound.demandIdentity &&
        session.completedLineIds.length === 0 &&
        shoppingListDemandIdentity(currentBasket) === clearedRound.demandIdentity
      )
    },

    /**
     * Restore a single deliberate clear in the same physical round only.
     * Does not write: the user-event owner calls persist() explicitly.
     */
    undoClear(): ShoppingProgressSessionV2 {
      if (!this.canUndoClear()) {
        clearedRound = null
        return snapshot()
      }
      const previous = clearedRound!
      clearedRound = null
      session = startShoppingProgressSessionV2(
        currentBasket,
        serializeShoppingProgressV2(currentBasket, previous.completedLineIds),
      )
      return snapshot()
    },

    /**
     * Explicitly call only after a user event / approved effect, never during
     * render. Invalid basket or blocked storage never writes stale state.
     */
    persist(): boolean {
      if (!storageReadable || storage === null || session.serialized === null) {
        return false
      }
      try {
        // Reject a stale snapshot if a caller mutated the basket after toggle
        // but before this explicit write. Financial-only updates retain identity.
        if (shoppingListDemandIdentity(currentBasket) !== session.demandIdentity) {
          return false
        }
        storage.setItem(shoppingListProgressV2StorageKey, session.serialized)
        return true
      } catch {
        return false
      }
    },
  }
}
