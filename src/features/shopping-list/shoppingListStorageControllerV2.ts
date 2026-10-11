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
 * Check both the envelope and any same-demand line IDs before accepting a
 * durable record. Foreign-task IDs cannot be verified against this basket,
 * but a valid foreign envelope may be replaced on a deliberate fresh switch.
 */
/**
 * JSON.parse silently accepts duplicate object keys using last-key-wins.
 * Refuse an ambiguous persisted root before a v2 client can drop a hidden
 * schema, demand identity, or set of checked line IDs during a later save.
 * Quoted/escaped string contents and nested objects are not root keys.
 */
function hasDuplicateRootKeys(raw: string): boolean {
  const keys = new Set<string>()
  let objectDepth = 0
  let arrayDepth = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (char === '"') {
      const start = i
      let escaped = false
      for (i++; i < raw.length; i++) {
        const quoted = raw[i]
        if (escaped) {
          escaped = false
        } else if (quoted === '\\') {
          escaped = true
        } else if (quoted === '"') {
          break
        }
      }
      if (i >= raw.length) return true
      if (objectDepth === 1 && arrayDepth === 0) {
        let next = i + 1
        while (next < raw.length && /\s/.test(raw[next])) next++
        if (raw[next] === ':') {
          const key: string = JSON.parse(raw.slice(start, i + 1))
          if (keys.has(key)) return true
          keys.add(key)
        }
      }
    } else if (char === '{') {
      objectDepth++
    } else if (char === '}') {
      objectDepth--
    } else if (char === '[') {
      arrayDepth++
    } else if (char === ']') {
      arrayDepth--
    }
  }
  return false
}

/**
 * A v2 client's "foreign basket" exception only applies to identities this
 * client could itself produce. Any other opaque string may belong to a later
 * schema or corrupted record and must remain byte-for-byte read-only.
 *
 * Reconstruct the physical shape and reuse the single canonical identity
 * builder; comparing its exact serialization also detects duplicate/unknown
 * identity fields and non-canonical forms without inventing a second schema.
 */
function isCanonicalPhysicalDemandIdentity(rawIdentity: string): boolean {
  try {
    const parsed: unknown = JSON.parse(rawIdentity)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const input = parsed as Record<string, unknown>
    if (input.schemaVersion !== 2 || !Array.isArray(input.lines)) return false

    const lines = input.lines.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const line = value as Record<string, unknown>
      const physical = {
        id: line.id,
        status: line.status,
        requirement: { amount: line.amount, unit: line.unit },
      }
      return line.status === 'matched'
        ? {
            ...physical,
            productId: line.productId,
            packs: line.packs,
            pack: {
              amount: line.packAmount,
              unit: line.packUnit,
              count: line.packCount,
            },
          }
        : physical
    })

    return shoppingListDemandIdentity({
      store: { id: input.storeId },
      lines,
    } as unknown as OneStoreBasket) === rawIdentity
  } catch {
    return false
  }
}

function recognizedStoredV2(raw: string | null, basket: OneStoreBasket): boolean {
  if (raw === null) return true
  if (typeof raw !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(raw)
    if (hasDuplicateRootKeys(raw)) return false
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const item = parsed as Record<string, unknown>
    // Preserve compatibility with legacy optional note metadata already accepted
    // by v2; treat any other extension as newer-client-owned and read-only.
    // This is deliberately not a blanket rejection of all optional root data.
    const compatibleRootKeys = new Set([
      'schemaVersion', 'demandIdentity', 'doneLineIds',
      'note', 'metadata', 'futureDescription',
    ])
    if (Object.keys(item).some((field) => !compatibleRootKeys.has(field))) return false
    if (
      !Object.hasOwn(item, 'schemaVersion') || item.schemaVersion !== 2 ||
      !Object.hasOwn(item, 'demandIdentity') ||
      typeof item.demandIdentity !== 'string' || item.demandIdentity.length === 0 ||
      !Object.hasOwn(item, 'doneLineIds') || !Array.isArray(item.doneLineIds) ||
      !item.doneLineIds.every((lineId) => typeof lineId === 'string')
    ) return false

    // Silently deduplicating a durable checklist can destroy information.
    if (new Set(item.doneLineIds).size !== item.doneLineIds.length) return false
    // A nonempty opaque string is not proof of a supported *foreign* v2 task.
    // An older client must not turn it into its own physical basket on save.
    if (!isCanonicalPhysicalDemandIdentity(item.demandIdentity)) return false
    const liveIdentity = shoppingListDemandIdentity(basket)
    if (liveIdentity !== item.demandIdentity) return true

    // A v2 record for this exact physical task must be restorable without
    // dropping any line IDs. A future/foreign ID is not an empty checkmark.
    const knownIds = new Set(basket.lines.map((line) => line.id))
    return item.doneLineIds.every((lineId) => knownIds.has(lineId))
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
  // Pin explicit migration consent once within the guarded storage preflight.
  let allowLegacyUpgrade = false

  if (storage !== null) {
    try {
      initialV2 = storage.getItem(shoppingListProgressV2StorageKey)
      storageReadable = true
      if (initialV2 === null) {
        // A present v2 record never needs a legacy option read. Hostile or
        // stateful runtime option getters may throw; handle them only here.
        allowLegacyUpgrade = options?.allowLegacyUpgrade === true
        if (allowLegacyUpgrade) initialV1 = storage.getItem(shoppingListProgressStorageKey)
      }
    } catch {
      // Do not trust partial storage reads or turn a failure into migration.
      storageReadable = false
      initialV2 = null
      initialV1 = null
      allowLegacyUpgrade = false
    }
  }

  // The last durable v2 value observed by this controller. A separate tab
  // may save a different checklist while this tab is open.
  let lastObservedV2 = initialV2
  // Unsupported stored bytes are read-only until a deliberate valid recovery.
  let storageFormatSupported = storageReadable && recognizedStoredV2(initialV2, basket)
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
      allowLegacyUpgrade: storageReadable && allowLegacyUpgrade,
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
      // A record that was foreign when opened can become same-demand after
      // switching physical baskets. Recheck its raw pinned bytes before any
      // write; once protected, a rebase must never implicitly unlock them.
      if (storageFormatSupported && !recognizedStoredV2(lastObservedV2, nextBasket)) {
        storageFormatSupported = false
      }
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
        if (!recognizedStoredV2(observed, currentBasket)) return null
        // A previously protected record must never be rebound to a foreign
        // physical task by an ordinary reload, even before a failed save.
        if ((failedPersistAttempt || !storageFormatSupported || options.requireSameDemand === true) && observed !== null) {
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
        const observed = storage.getItem(shoppingListProgressV2StorageKey)
        if (observed !== lastObservedV2) {
          // A newer tab might have written an unsupported future version or
          // corrupt record, not merely another valid set of checkmarks.
          // Surface the existing protected-record warning on this explicit
          // save failure, and keep writes blocked until deliberate recovery.
          if (!recognizedStoredV2(observed, currentBasket)) {
            storageFormatSupported = false
          }
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
