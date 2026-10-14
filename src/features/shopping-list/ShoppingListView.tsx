import { useEffect, useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
  shoppingListProgressStorageKey,
} from './shoppingListProgress'

function shoppingQuantity(line: OneStoreBasket['lines'][number]) {
  if (line.status === 'unresolved') {
    return `${line.requirement.amount ?? '?'} ${quantityUnitLabelNl(line.requirement.unit, line.requirement.amount)} · handmatig kiezen`
  }

  const packPrefix = line.pack.count > 1 ? `${line.pack.count} × ` : ''
  return `${line.packs} × ${packPrefix}${line.pack.amount} ${quantityUnitLabelNl(line.pack.unit, line.pack.amount)}`
}

function readStoredProgress(basket: OneStoreBasket) {
  if (typeof window === 'undefined') return []

  try {
    return restoreShoppingListProgress(
      basket,
      window.localStorage.getItem(shoppingListProgressStorageKey),
    )
  } catch {
    return []
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
  const basketKey = useMemo(() => shoppingListBasketKey(basket), [basket])
  const [progress, setProgress] = useState(() => ({
    basketKey,
    done: readStoredProgress(basket),
  }))
  const done = progress.basketKey === basketKey ? progress.done : []

  // A genuinely empty plan has no shopping tasks. An empty row array with
  // inconsistent counters is not proof that the customer needs nothing.
  const genuinelyEmpty =
    basket.lines.length === 0 &&
    basket.selectedMealCount === 0 &&
    basket.matchedLineCount === 0 &&
    basket.unresolvedLineCount === 0 &&
    basket.totalCents === 0

  useEffect(() => {
    if (progress.basketKey === basketKey) return

    setProgress({
      basketKey,
      done: readStoredProgress(basket),
    })
  }, [basket, basketKey, progress.basketKey])

  useEffect(() => {
    if (typeof window === 'undefined' || progress.basketKey !== basketKey) return

    try {
      // Re-read immediately before write. This is protective, not atomic
      // cross-tab compare-and-swap; any access denial must also prevent writes.
      const stored = window.localStorage.getItem(shoppingListProgressStorageKey)
      if (!canOverwriteStoredProgress(stored)) return
      window.localStorage.setItem(
        shoppingListProgressStorageKey,
        serializeShoppingListProgress(basket, progress.done),
      )
    } catch {
      // Strict privacy modes can deny storage; the active session remains usable.
    }
  }, [basket, basketKey, progress])

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
                    basketKey,
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
