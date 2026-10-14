import { useId, useRef, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'
import { buildShoppingListCopyText } from './shoppingListCopyText'
import { selectShoppingCopyText } from './selectShoppingCopyText'
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
  const text = buildShoppingListCopyText(basket, doneLineIds)
  // Track every *rendered* basket-text change, including A -> B -> A.
  // Comparing text alone would reopen an earlier export without a fresh click.
  // A ref-based revision closes it synchronously during render, not after an
  // effect (which could briefly expose old text on a new planning snapshot).
  const displayedText = useRef({ value: text, revision: 0 })
  if (displayedText.current.value !== text) {
    displayedText.current = {
      value: text,
      revision: displayedText.current.revision + 1,
    }
  }
  const [expandedSnapshot, setExpandedSnapshot] = useState<{
    text: string
    revision: number
  } | null>(null)
  const expanded = Boolean(
    text && expandedSnapshot?.text === text &&
    expandedSnapshot.revision === displayedText.current.revision,
  )
  const fieldId = useId()
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  function toggleExport() {
    if (!text) return
    const revision = displayedText.current.revision
    setExpandedSnapshot(current =>
      current?.text === text && current.revision === revision
        ? null
        : { text, revision },
    )
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
          <textarea id={fieldId} ref={textAreaRef} readOnly rows={8}
            value={text} onFocus={event => event.currentTarget.select()}
            className="shopping-copy__text" />
          <button type="button" className="shopping-copy__button"
            aria-controls={fieldId}
            onClick={() => selectShoppingCopyText(textAreaRef.current, text)}>
            Selecteer alle tekst
          </button>
          <span className="shopping-copy__status">
            Kies daarna Kopieer op je apparaat.
          </span>
        </div>
      )}
    </div>
  )
}
