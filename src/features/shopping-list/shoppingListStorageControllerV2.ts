import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'
import { shoppingListProgressStorageKey } from './shoppingListProgress.ts'
import { shoppingListProgressV2StorageKey } from './shoppingListProgressV2.ts'
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

  // The last durable v2 value observed by this controller. A separate tab
  // may save a different checklist while this tab is open.
  let lastObservedV2 = initialV2

  let currentBasket = basket
  let session = startShoppingProgressSessionV2(
    basket,
    storageReadable ? initialV2 : null,
    {
      allowLegacyUpgrade: storageReadable && options.allowLegacyUpgrade === true,
      rawV1: initialV1,
    },
  )

  const snapshot = (): ShoppingProgressSessionV2 => ({
    ...session,
    completedLineIds: [...session.completedLineIds],
  })

  return {
    snapshot,

    rebase(nextBasket: OneStoreBasket): ShoppingProgressSessionV2 {
      session = rebaseShoppingProgressSessionV2(session, nextBasket)
      currentBasket = nextBasket
      return snapshot()
    },

    toggle(lineId: unknown): ShoppingProgressSessionV2 {
      session = toggleShoppingProgressSessionV2(session, currentBasket, lineId)
      return snapshot()
    },

    /**
     * Only a deliberate user action should call this. Restarting the current
     * shopping round writes an empty v2 completion snapshot after the caller
     * explicitly invokes persist(); the legacy v1 key remains untouched.
     */
    clear(): ShoppingProgressSessionV2 {
      session = startShoppingProgressSessionV2(currentBasket, null)
      return snapshot()
    },

    /**
     * Recover from another tab's newer saved checklist only after a deliberate
     * user action. Discards unsaved local ticks on successful read, without
     * persisting, migrating v1, or adopting a foreign physical basket.
     * Failed/denied reads never modify the session or pinned storage revision.
     */
    reloadSaved(): ShoppingProgressSessionV2 | null {
      if (storage === null) return null
      try {
        const liveIdentity = shoppingListDemandIdentity(currentBasket)
        if (liveIdentity === null) return null

        // Always read the v2 key alone: a present/missing v2 revision never
        // authorizes a surprise legacy import during conflict recovery.
        const observed = storage.getItem(shoppingListProgressV2StorageKey)
        const refreshed = startShoppingProgressSessionV2(currentBasket, observed)
        if (refreshed.demandIdentity !== liveIdentity || refreshed.serialized === null) {
          return null
        }

        // Pin the exact observed value before allowing subsequent explicit
        // writes. A later external change still fails the persist guard.
        session = refreshed
        lastObservedV2 = observed
        storageReadable = true
        return snapshot()
      } catch {
        return null
      }
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
        // Best-effort stale-tab guard: localStorage has no atomic CAS, but a
        // newly observed value must never be silently overwritten by our
        // outdated in-memory checklist. Also fail closed on denied reads.
        if (storage.getItem(shoppingListProgressV2StorageKey) !== lastObservedV2) {
          return false
        }
        storage.setItem(shoppingListProgressV2StorageKey, session.serialized)
        // Advance only after a confirmed successful write. Denied writes can
        // be explicitly retried while the durable value stays unchanged.
        lastObservedV2 = session.serialized
        return true
      } catch {
        return false
      }
    },
  }
}
