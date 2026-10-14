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

/** Commit only a finished amount; "2," is an edit in progress, not an observed €2. */
export function observationFinalPriceCents(text: unknown): number | null {
  if (typeof text !== 'string' || /[.,]$/.test(text.trim())) return null
  return observationPriceCents(text)
}

export function ObservationPriceInput({
  priceCents,
  onPriceChange,
  label,
}: {
  priceCents: number | null
  label: string
  onPriceChange: (value: number | null) => void
}) {
  // Do not persist a half-typed value. The canonical draft changes only on
  // blur, so "2," or temporarily invalid digits cannot become a false
  // observed store price through localStorage autosave.
  const hintId = useId()
  const [editingText, setEditingText] = useState<string | null>(null)
  const currentText = editingText ?? observationEditablePriceText(priceCents)
  const invalidEntry =
    editingText !== null &&
    editingText.trim() !== '' &&
    observationFinalPriceCents(editingText) === null

  return (
    <>
      <input
        type="text"
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        value={currentText}
        aria-invalid={invalidEntry}
        aria-describedby={invalidEntry ? hintId : undefined}
        onFocus={() => setEditingText(observationEditablePriceText(priceCents))}
        onChange={(event) => {
          setEditingText(event.target.value)
        }}
        onBlur={(event) => {
          onPriceChange(observationFinalPriceCents(event.currentTarget.value))
          setEditingText(null)
        }}
      />
      {invalidEntry && (
        <small id={hintId} role="status">
          Gebruik een bedrag in euro's met maximaal twee decimalen, bijvoorbeeld 2,49.
        </small>
      )}
    </>
  )
}
