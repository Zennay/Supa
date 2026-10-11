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
/**
 * An old client must never convert an unknown future format (or corrupt
 * existing data) into an empty v2 list and overwrite the original bytes.
 * Only check the storage envelope here; physical-demand matching stays with
 * the existing v2 restore/rebase path. The v2 key may legitimately belong to
 * another *recognized* shopping task when a user switches stores.
 */
function recognizedStoredV2(raw: string | null): boolean {
  if (raw === null) return true
  if (typeof raw !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const item = parsed as Record<string, unknown>
    return (
      Object.hasOwn(item, 'schemaVersion') && item.schemaVersion === 2 &&
      Object.hasOwn(item, 'demandIdentity') &&
      typeof item.demandIdentity === 'string' && item.demandIdentity.length > 0 &&
      Object.hasOwn(item, 'doneLineIds') &&
      Array.isArray(item.doneLineIds) &&
      item.doneLineIds.every((lineId) => typeof lineId === 'string')
    )
  } catch {
    return false
  }
}

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
  // Unsupported stored bytes are read-only until a deliberate valid recovery.
  let storageFormatSupported = storageReadable && recognizedStoredV2(initialV2)
  // Any failed explicit save may predate a newer physical shopping task,
  // including an initially denied read or a quota-denied write. A later
  // recovery must not turn that foreign saved task into an empty local list.
  // A fresh controller with no failed save can still start a different task.
  let failedPersistAttempt = false

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

    /** A null browser port cannot be retried; a temporarily denied port can. */
    canRetryStorageRead(): boolean {
      return storage !== null
    },

    /** Display-only diagnostic; never exposes or rewrites stored bytes. */
    storageFormatStatus(): 'ready' | 'unknown-record' | 'unavailable' {
      if (!storageReadable) return 'unavailable'
      return storageFormatSupported ? 'ready' : 'unknown-record'
    },

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
     * UI protected-record rechecks opt into a same-demand-only read even before
     * any failed save; regular read-only recovery retains existing semantics.
     */
    reloadSaved(options: Readonly<{ requireSameDemand?: boolean }> = {}): ShoppingProgressSessionV2 | null {
      if (storage === null) return null
      try {
        const liveIdentity = shoppingListDemandIdentity(currentBasket)
        if (liveIdentity === null) return null

        // Always read the v2 key alone: a present/missing v2 revision never
        // authorizes a surprise legacy import during conflict recovery.
        const observed = storage.getItem(shoppingListProgressV2StorageKey)
        // Even a manual reload must not adopt and pin an unknown schema.
        if (!recognizedStoredV2(observed)) return null
        if ((failedPersistAttempt || options.requireSameDemand === true) && observed !== null) {
          // A previous stale write proved another tab changed the checklist.
          // Never convert its *different* physical task into an empty current
          // task and then pin its revision, which would enable rollback.
          const parsed: unknown = JSON.parse(observed)
          if (
            parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ||
            !('schemaVersion' in parsed) || parsed.schemaVersion !== 2 ||
            !('demandIdentity' in parsed) || parsed.demandIdentity !== liveIdentity ||
            !('doneLineIds' in parsed) || !Array.isArray(parsed.doneLineIds)
          ) {
            return null
          }
        }
        const refreshed = startShoppingProgressSessionV2(currentBasket, observed)
        if (refreshed.demandIdentity !== liveIdentity || refreshed.serialized === null) {
          return null
        }

        // Pin the exact observed value before allowing subsequent explicit
        // writes. A later external change still fails the persist guard.
        session = refreshed
        lastObservedV2 = observed
        storageReadable = true
        storageFormatSupported = true
        failedPersistAttempt = false
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
      if (!storageReadable || !storageFormatSupported || storage === null || session.serialized === null) {
        failedPersistAttempt = true
        return false
      }
      try {
        // Reject a stale snapshot if a caller mutated the basket after toggle
        // but before this explicit write. Financial-only updates retain identity.
        if (shoppingListDemandIdentity(currentBasket) !== session.demandIdentity) {
          failedPersistAttempt = true
          return false
        }
        // Best-effort stale-tab guard: localStorage has no atomic CAS, but a
        // newly observed value must never be silently overwritten by our
        // outdated in-memory checklist. Also fail closed on denied reads.
        if (storage.getItem(shoppingListProgressV2StorageKey) !== lastObservedV2) {
          failedPersistAttempt = true
          return false
        }
        storage.setItem(shoppingListProgressV2StorageKey, session.serialized)
        // Advance only after a confirmed successful write. Denied writes can
        // be explicitly retried while the durable value stays unchanged.
        lastObservedV2 = session.serialized
        failedPersistAttempt = false
        return true
      } catch {
        failedPersistAttempt = true
        return false
      }
    },
  }
}
