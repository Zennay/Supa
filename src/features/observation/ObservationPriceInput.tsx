import { useId, useState } from 'react'
import { observationPriceCents } from './observationCollectionUi.ts'

/** The canonical draft stores integer cents, never partial input or guessed prices. */
export function observationEditablePriceText(priceCents: number | null): string {
  if (priceCents === null || !Number.isSafeInteger(priceCents) || priceCents < 0) {
    return ''
  }

  const whole = Math.floor(priceCents / 100)
  const cents = String(priceCents % 100).padStart(2, '0')
  return `${whole},${cents}`
}

export function ObservationPriceInput({
  priceCents,
  onPriceChange,
}: {
  priceCents: number | null
  onPriceChange: (value: number | null) => void
}) {
  // Keep an in-progress entry visible while its canonical cent value changes.
  // Without this local buffer, a controlled input reformats "1," to "1,00"
  // before a person can type the cents.
  const hintId = useId()
  const [editingText, setEditingText] = useState<string | null>(null)
  const currentText = editingText ?? observationEditablePriceText(priceCents)
  const invalidEntry =
    editingText !== null &&
    editingText.trim() !== '' &&
    observationPriceCents(editingText) === null

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={currentText}
        aria-invalid={invalidEntry}
        aria-describedby={invalidEntry ? hintId : undefined}
        onFocus={() => setEditingText(observationEditablePriceText(priceCents))}
        onChange={(event) => {
          const nextText = event.target.value
          setEditingText(nextText)
          // Invalid or partial values are not accepted as prices in a saved draft.
          onPriceChange(observationPriceCents(nextText))
        }}
        onBlur={() => setEditingText(null)}
      />
      {invalidEntry && (
        <small id={hintId} role="status">
          Gebruik een bedrag in euro's met maximaal twee decimalen, bijvoorbeeld 2,49.
        </small>
      )}
    </>
  )
}
