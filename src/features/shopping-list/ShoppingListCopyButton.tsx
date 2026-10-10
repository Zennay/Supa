import { useEffect, useId, useRef, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import { buildShoppingListCopyText } from './shoppingListCopyText'
import './shoppingListCopyButton.css'

/**
 * A selectable text export; deliberately NO Clipboard API.
 * The project's privileged-capability gate forbids programmatic clipboard
 * writes. A native read-only text area lets the user copy via their device.
 */
export function ShoppingListCopyButton({
  basket,
  doneLineIds,
}: {
  basket: OneStoreBasket
  doneLineIds: readonly string[]
}) {
  const [expanded, setExpanded] = useState(false)
  const text = buildShoppingListCopyText(basket, doneLineIds)
  const fieldId = useId()
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setExpanded(false), [basket, doneLineIds])

  function toggleExport() {
    if (!text) return
    setExpanded(current => !current)
  }

  return (
    <div className="shopping-copy">
      <button type="button" className="shopping-copy__button"
        disabled={!text} aria-expanded={expanded} aria-controls={fieldId}
        onClick={toggleExport}>
        {expanded ? 'Verberg kopieerbare lijst' : 'Toon kopieerbare lijst'}
      </button>
      {!text && (
        <span role="status" className="shopping-copy__status">
          De boodschappenlijst kan nog niet veilig worden gekopieerd.
        </span>
      )}
      {expanded && text && (
        <div className="shopping-copy__detail">
          <label htmlFor={fieldId}>Boodschappenlijst om te kopiëren</label>
          <textarea id={fieldId} ref={field} readOnly rows={8}
            value={text} onFocus={event => event.currentTarget.select()}
            className="shopping-copy__text" />
          <span className="shopping-copy__status">
            Selecteer de tekst en kies Kopieer op je apparaat.
          </span>
        </div>
      )}
    </div>
  )
}
