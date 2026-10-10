import { useEffect, useRef, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import { buildShoppingListCopyText } from './shoppingListCopyText'
import './shoppingListCopyButton.css'

type Status = 'idle' | 'copied' | 'unavailable'

/**
 * Opt-in clipboard transfer: no network call and no background clipboard read.
 * The surrounding ShoppingListView owns live checkbox state.
 */
export function ShoppingListCopyButton({
  basket,
  doneLineIds,
}: {
  basket: OneStoreBasket
  doneLineIds: readonly string[]
}) {
  const [status, setStatus] = useState<Status>('idle')
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    setStatus('idle')
  }, [basket, doneLineIds])

  async function copyList() {
    const text = buildShoppingListCopyText(basket, doneLineIds)
    const requestGeneration = generation.current

    if (!text || typeof navigator === 'undefined' ||
        typeof navigator.clipboard?.writeText !== 'function') {
      setStatus('unavailable')
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      if (generation.current === requestGeneration) setStatus('copied')
    } catch {
      if (generation.current === requestGeneration) setStatus('unavailable')
    }
  }

  return (
    <div className="shopping-copy">
      <button type="button" className="shopping-copy__button" onClick={copyList}>
        Kopieer boodschappenlijst
      </button>
      {status !== 'idle' && (
        <span className="shopping-copy__status" role="status" aria-live="polite">
          {status === 'copied'
            ? 'Boodschappenlijst gekopieerd.'
            : 'Kopiëren is hier niet beschikbaar. Gebruik de lijst in SUPA.'}
        </span>
      )}
    </div>
  )
}
