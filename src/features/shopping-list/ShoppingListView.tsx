import { useEffect, useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation'
import { ShoppingListCompletionBanner } from './ShoppingListCompletionBanner'
import { ShoppingListCopyButton } from './ShoppingListCopyButton'
import { PrintableShoppingChecklist } from './PrintableShoppingChecklist'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
  shoppingListProgressStorageKey,
} from './shoppingListProgress'

// An empty checklist is trustworthy only when its store identity is readable.
// This guards the empty-state message, not ordinary populated product rows.
const invisibleStoreFillers = /[\u115F\u1160\u3164\uFFA0\u2800]/gu

function visibleStoreIdentity(value: unknown): boolean {
  return typeof value === 'string' &&
    value === value.trim() &&
    /[\p{L}\p{N}]/u.test(value.replace(invisibleStoreFillers, ''))
}

function visibleStoreName(value: unknown): boolean {
  return typeof value === 'string' &&
    /[\p{L}\p{N}\p{S}]/u.test(value.replace(invisibleStoreFillers, ''))
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
    // A denied initial read must not be mistaken for proof of an empty key.
    return { done: [], readDenied: true }
  }
}

// A v1 client must not destroy unsupported, newer or unreadable persisted state.
// Refuse writes until the key is absent or a strictly recognized v1 snapshot.
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
  const basketKey = useMemo(() => {
    try {
      return shoppingListBasketKey(basket)
    } catch {
      // A damaged basket is not a new empty shopping plan. Never show or
      // persist checkmarks under a fabricated identity.
      return null
    }
  }, [basket])
  const [progress, setProgress] = useState(() => ({
    basketKey,
    ...(basketKey === null
      ? { done: [], readDenied: false }
      : readStoredProgress(basket)),
    dirty: false,
    retryAfterFailure: false,
  }))
  const [storageWarning, setStorageWarning] = useState<'protected' | 'unavailable' | null>(null)
  const done = progress.basketKey === basketKey ? progress.done : []

  // A genuinely empty plan has no shopping tasks. An empty row array with
  // inconsistent counters is not proof that the customer needs nothing.
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
      ...(basketKey === null
        ? { done: [], readDenied: false }
        : readStoredProgress(basket)),
      dirty: false,
      retryAfterFailure: false,
    })
  }, [basket, basketKey, progress.basketKey])

  useEffect(() => {
    if (typeof window === 'undefined' || basketKey === null || progress.basketKey !== basketKey) return
    // Never persist a malformed zero-row basket just because it is visible.
    if (basket.lines.length === 0 && !genuinelyEmpty) return

    // A failed read or write is not an authorization to retry automatically.
    if ((progress.readDenied || progress.retryAfterFailure) && !progress.dirty) {
      if (!progress.retryAfterFailure) setStorageWarning('unavailable')
      return
    }

    try {
      const stored = window.localStorage.getItem(shoppingListProgressStorageKey)
      // If the initial read was denied, later-readable existing bytes might
      // contain previously checked rows. Refuse to replace them with [].
      if ((progress.readDenied && stored !== null) ||
          !canOverwriteStoredProgress(stored)) {
        setProgress((current) => current === progress
          ? { ...current, dirty: false, retryAfterFailure: true }
          : current)
        setStorageWarning('protected')
        return
      }

      const serialized = serializeShoppingListProgress(basket, progress.done)
      if (stored !== serialized) {
        window.localStorage.setItem(shoppingListProgressStorageKey, serialized)
      }
      if (progress.readDenied || progress.retryAfterFailure) {
        setProgress((current) => current === progress
          ? { ...current, readDenied: false, dirty: false, retryAfterFailure: false }
          : current)
      }
      setStorageWarning(null)
    } catch {
      // A future passive rerender or permission recovery must not silently
      // retry an already-failed save and falsely suggest persistent progress.
      setProgress((current) => current === progress
        ? { ...current, dirty: false, retryAfterFailure: true }
        : current)
      setStorageWarning('unavailable')
    }
  }, [basket, basketKey, genuinelyEmpty, progress])

  if (basketKey === null) {
    return (
      <section className="screen">
        <div className="section-heading">
          <div>
            <span className="eyebrow">In de winkel</span>
            <h2>Boodschappenlijst</h2>
          </div>
        </div>
        <p className="disclaimer" role="status">
          Boodschappenlijst niet beschikbaar. Controleer je planning.
        </p>
        <p className="disclaimer" role="status">
          Afdrukken is niet beschikbaar. Controleer eerst je boodschappenlijst.
        </p>
      </section>
    )
  }

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
            : 'Afvinken is tijdelijk en niet opgeslagen omdat opslag niet beschikbaar is. Eventuele eerdere opgeslagen gegevens blijven bewaard.'}
        </p>
      )}

      {basket.lines.length > 0 && (
        <ShoppingListCompletionBanner basket={basket} doneLineIds={done} />
      )}

      <ShoppingListCopyButton basket={basket} doneLineIds={done} />
      <PrintableShoppingChecklist basket={basket} doneLineIds={done} />

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
              type="button"
              aria-pressed={checked}
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
                    done: currentDone.includes(line.id)
                      ? currentDone.filter((id) => id !== line.id)
                      : [...currentDone, line.id],
                  }
                })
              }
            >
              <span className="check" aria-hidden="true">{checked ? '✓' : ''}</span>
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
