import { useEffect, useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'
import { isTrustworthyShoppingBasket } from './shoppingListPhysicalValidity.ts'
import {
  shoppingListProgressV2StorageKey,
} from './shoppingListProgressV2.ts'
import {
  reconcileTrustedShoppingProgressV2,
  restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
  upgradeTrustedLegacyProgressV1,
} from './shoppingListTrustedProgressV2.ts'
import { shoppingListProgressStorageKey } from './shoppingListProgress'
import { ShoppingListCompletionBanner } from './ShoppingListCompletionBanner.tsx'
import { ShoppingListCopyButton } from './ShoppingListCopyButton.tsx'

function shoppingQuantity(line: OneStoreBasket['lines'][number]) {
  if (line.status === 'unresolved') {
    return `${line.requirement.amount ?? '?'} ${line.requirement.unit} · handmatig kiezen`
  }

  const packPrefix = line.pack.count > 1 ? `${line.pack.count} × ` : ''
  return `${line.packs} × ${packPrefix}${line.pack.amount} ${line.pack.unit}`
}

function readStoredProgress(basket: OneStoreBasket): string[] {
  if (typeof window === 'undefined' || !isTrustworthyShoppingBasket(basket)) {
    return []
  }

  try {
    // An existing v2 record is authoritative, including malformed/empty data.
    // Never reinterpret it as v1 or resurrect stale completed products.
    const savedV2 = window.localStorage.getItem(shoppingListProgressV2StorageKey)
    if (savedV2 !== null) return restoreTrustedShoppingProgressV2(basket, savedV2)

    // One-way opt-in migration is allowed only when the old *priced* basket
    // matches exactly. Price refreshes must not guess a legacy equivalent.
    const upgraded = upgradeTrustedLegacyProgressV1(
      basket,
      window.localStorage.getItem(shoppingListProgressStorageKey),
    )
    if (upgraded === null) return []
    window.localStorage.setItem(shoppingListProgressV2StorageKey, upgraded)
    return restoreTrustedShoppingProgressV2(basket, upgraded)
  } catch {
    // A locked-down browser may deny storage, but local session toggles work.
    return []
  }
}

export function ShoppingListView({ basket }: { basket: OneStoreBasket }) {
  // Physically identical baskets retain a stable key even when prices change.
  // Financially invalid snapshots may never restore or persist checked state.
  const basketKey = useMemo(
    () => isTrustworthyShoppingBasket(basket)
      ? shoppingListDemandIdentity(basket)
      : null,
    [basket],
  )
  const [progress, setProgress] = useState(() => ({
    basket,
    basketKey,
    done: readStoredProgress(basket),
  }))
  const done = basketKey !== null && progress.basketKey === basketKey
    ? progress.done
    : []

  useEffect(() => {
    // Same physical task: keep the checks on a price-only refresh.
    // Changed physical task: attempt a trusted read; stale v2 keys fail closed.
    if (progress.basketKey === basketKey) return
    setProgress({
      basket,
      basketKey,
      done: readStoredProgress(basket),
    })
  }, [basket, basketKey, progress.basketKey])

  useEffect(() => {
    if (typeof window === 'undefined' ||
        basketKey === null ||
        progress.basketKey !== basketKey) return

    const saved = serializeTrustedShoppingProgressV2(basket, progress.done)
    if (saved === null) return

    try {
      window.localStorage.setItem(shoppingListProgressV2StorageKey, saved)
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
                    current.basketKey === basketKey
                      ? reconcileTrustedShoppingProgressV2(
                          current.basket, basket, current.done,
                        )
                      : []
                  return {
                    basket,
                    basketKey,
                    done: toggleTrustedShoppingProgressV2(
                      basket, currentDone, line.id,
                    ),
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

      {/* Completion follows the *current* trusted basket-scoped checked IDs.
          An unresolved match is never represented as a finished purchase. */}
      <ShoppingListCompletionBanner basket={basket} doneLineIds={done} />

      {/* Export is scoped to the SAME current trusted v2 checkmarks; no stale
          progress or copied retailer-price/savings claim is permitted. */}
      <ShoppingListCopyButton basket={basket} doneLineIds={done} />
    </section>
  )
}
