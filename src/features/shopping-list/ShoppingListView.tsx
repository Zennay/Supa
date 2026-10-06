import { useEffect, useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
  shoppingListProgressStorageKey,
} from './shoppingListProgress'

function shoppingQuantity(line: OneStoreBasket['lines'][number]) {
  if (line.status === 'unresolved') {
    return `${line.requirement.amount ?? '?'} ${line.requirement.unit} · handmatig kiezen`
  }

  const packPrefix = line.pack.count > 1 ? `${line.pack.count} × ` : ''
  return `${line.packs} × ${packPrefix}${line.pack.amount} ${line.pack.unit}`
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

export function ShoppingListView({ basket }: { basket: OneStoreBasket }) {
  const basketKey = useMemo(() => shoppingListBasketKey(basket), [basket])
  const [progress, setProgress] = useState(() => ({
    basketKey,
    done: readStoredProgress(basket),
  }))
  const done = progress.basketKey === basketKey ? progress.done : []

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
        {basket.lines.map((line) => {
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
                    basketKey,
                    done: checked
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
