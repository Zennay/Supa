import { useEffect, useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
  shoppingListProgressStorageKey,
} from './shoppingListProgress'

// This only gates the EMPTY-WEEK message, not all populated basket rows.
// Display/integrity data must not turn an invalid store into "nothing to buy".
const invisibleStoreFillers = /[\u115F\u1160\u3164\uFFA0\u2800]/gu

function visibleStoreIdentity(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    /[\p{L}\p{N}]/u.test(value.replace(invisibleStoreFillers, ''))
  )
}

function visibleStoreName(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /[\p{L}\p{N}\p{S}]/u.test(value.replace(invisibleStoreFillers, ''))
  )
}

function shoppingQuantity(line: OneStoreBasket['lines'][number]) {
  if (line.status === 'unresolved') {
    return `${line.requirement.amount ?? '?'} ${quantityUnitLabelNl(line.requirement.unit, line.requirement.amount)} · handmatig kiezen`
  }

  const packPrefix = line.pack.count > 1 ? `${line.pack.count} × ` : ''
  return `${line.packs} × ${packPrefix}${line.pack.amount} ${quantityUnitLabelNl(line.pack.unit, line.pack.amount)}`
}

function readStoredProgress(basket: OneStoreBasket) {
  if (typeof window === 'undefined') return { done: [], readDenied: false }

  try {
    return {
      done: restoreShoppingListProgress(
        basket,
        window.localStorage.getItem(shoppingListProgressStorageKey),
      ),
      readDenied: false,
    }
  } catch {
    // A failed read must not be treated as confirmed empty saved progress.
    return { done: [], readDenied: true }
  }
}

// A v1 client must not destroy a newer/unknown or corrupt persisted record.
// Keep session-local checkmarks usable; decline writes until the key is absent
// or contains precisely this client's supported v1 envelope.
function canOverwriteStoredProgress(raw: string | null): boolean {
  if (raw === null) return true
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return (
      record.schemaVersion === 1 &&
      typeof record.basketKey === 'string' &&
      record.basketKey.length > 0 &&
      Array.isArray(record.doneLineIds) &&
      record.doneLineIds.every((id: unknown) => typeof id === 'string') &&
      Object.keys(record).every((key) =>
        key === 'schemaVersion' || key === 'basketKey' || key === 'doneLineIds'
      )
    )
  } catch {
    return false
  }
}

export function ShoppingListView({ basket }: { basket: OneStoreBasket }) {
  const basketKey = useMemo(() => shoppingListBasketKey(basket), [basket])
  const [progress, setProgress] = useState(() => ({
    basketKey,
    ...readStoredProgress(basket),
    dirty: false,
    retryAfterFailure: false,
  }))
  const [storageWarning, setStorageWarning] = useState<'protected' | 'unavailable' | null>(null)
  const done = progress.basketKey === basketKey ? progress.done : []
  // An actually empty plan is different from a malformed basket with no rows.
  // Never tell someone they have nothing to buy if the counters disagree.
  const genuinelyEmpty =
    basket.lines.length === 0 &&
    basket.selectedMealCount === 0 &&
    basket.matchedLineCount === 0 &&
    basket.unresolvedLineCount === 0 &&
    basket.totalCents === 0 &&
    visibleStoreIdentity(basket.store?.id) &&
    visibleStoreName(basket.store?.name)

  useEffect(() => {
    if (progress.basketKey === basketKey) return

    setProgress({
      basketKey,
      ...readStoredProgress(basket),
      dirty: false,
      retryAfterFailure: false,
    })
  }, [basket, basketKey, progress.basketKey])

  useEffect(() => {
    if (typeof window === 'undefined' || progress.basketKey !== basketKey) return
    // A malformed rowless store is not a valid empty shopping task. Never
    // overwrite the existing v1 record while showing an untrusted warning.
    if (basket.lines.length === 0 && !genuinelyEmpty) return
    // A missing initial read is not proof that previously checked items were
    // empty. Never write a fallback snapshot until an explicit user edit.
    if ((progress.readDenied || progress.retryAfterFailure) && !progress.dirty) {
      // An earlier denied/protected write may only be retried after another
      // deliberate checkbox change, not after an unrelated render or recovery.
      if (!progress.retryAfterFailure) setStorageWarning('unavailable')
      return
    }

    try {
      // Read immediately before writing: protect future/unknown/corrupt
      // records even if storage changed after mount. This is not atomic CAS.
      const stored = window.localStorage.getItem(shoppingListProgressStorageKey)
      // After a denied read, even a currently valid v1 record is foreign:
      // rewriting it from an empty fallback would erase unseen checkmarks.
      if ((progress.readDenied && stored !== null) ||
          !canOverwriteStoredProgress(stored)) {
        setProgress((current) => current === progress
          ? { ...current, dirty: false, retryAfterFailure: true }
          : current)
        setStorageWarning('protected')
        return
      }
      const serialized = serializeShoppingListProgress(basket, progress.done)
      // Avoid a second write when the safe-recovery state update rerenders.
      if (stored !== serialized) {
        window.localStorage.setItem(shoppingListProgressStorageKey, serialized)
      }
      if (progress.readDenied || progress.retryAfterFailure) {
        setProgress((current) => current === progress
          ? {
              ...current,
              readDenied: false,
              dirty: false,
              retryAfterFailure: false,
            }
          : current)
      }
      setStorageWarning(null)
    } catch {
      // Mark a failed action as spent. A future automatic effect is not a
      // new request to retry or silently claim persistent storage is healthy.
      setProgress((current) => current === progress
        ? { ...current, dirty: false, retryAfterFailure: true }
        : current)
      setStorageWarning('unavailable')
    }
  }, [basket, basketKey, genuinelyEmpty, progress])

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">In de winkel</span>
          <h2>Boodschappenlijst</h2>
        </div>
      </div>

      {basket.unresolvedLineCount > 0 && (
        <div className="attention-card">
          <strong>{basket.unresolvedLineCount} productkeuze vraagt controle</strong>
          <span>SUPA vult een onzekere match niet automatisch in.</span>
        </div>
      )}

      {storageWarning && (
        <p role="alert" className="disclaimer">
          {storageWarning === 'protected'
            ? 'Afvinken is tijdelijk en niet opgeslagen. Je eerdere opgeslagen gegevens blijven bewaard.'
            : 'Afvinken is tijdelijk en niet opgeslagen omdat opslag niet beschikbaar is.'}
        </p>
      )}

      <div className="list-card">
        {basket.lines.length === 0 ? (
          <p className="disclaimer" role="status">
            {genuinelyEmpty
              ? 'Geen boodschappen voor deze planning. Voeg een maaltijd toe in Planner.'
              : 'Boodschappenlijst niet beschikbaar. Controleer je planning.'}
          </p>
        ) : basket.lines.map((line) => {
          const checked = done.includes(line.id)
          const label =
            line.status === 'matched' ? line.productName : line.ingredientLabel

          return (
            <button
              className={
                line.status === 'unresolved'
                  ? checked
                    ? 'shopping-row checked unresolved-shopping'
                    : 'shopping-row unresolved-shopping'
                  : checked
                    ? 'shopping-row checked'
                    : 'shopping-row'
              }
              key={line.id}
              onClick={() =>
                setProgress((current) => {
                  const currentDone =
                    current.basketKey === basketKey ? current.done : []
                  return {
                    ...current,
                    basketKey,
                    dirty: true,
                    // The rendered `checked` flag may be stale if two taps
                    // queue before React paints. Toggle from latest state.
                    done: currentDone.includes(line.id)
                      ? currentDone.filter((id) => id !== line.id)
                      : [...currentDone, line.id],
                  }
                })
              }
            >
              <span className="check">{checked ? '✓' : ''}</span>
              <span>
                <strong>{label}</strong>
                <small>{shoppingQuantity(line)}</small>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
