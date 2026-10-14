import { useId, useState } from 'react'

/**
 * Human-observed package quantities are optional until collected.
 * Never round, truncate or interpret exponential syntax as a physical pack.
 */
export function observationFinalPackAmount(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const input = text.trim()
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(input)) return null

  const amount = Number(input.replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 && amount <= Number.MAX_SAFE_INTEGER
    ? amount
    : null
}

/** No scientific-notation conversion or display-time decimal rounding. */
export function observationEditablePackAmount(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount) || amount <= 0 ||
      amount > Number.MAX_SAFE_INTEGER) return ''
  return String(amount).replace('.', ',')
}

export function ObservationPackAmountInput({
  amount,
  label,
  onAmountChange,
}: {
  amount: number | null
  label: string
  onAmountChange: (amount: number | null) => void
}) {
  const hintId = useId()
  const [editingText, setEditingText] = useState<string | null>(null)
  const currentText = editingText ?? observationEditablePackAmount(amount)
  const invalid =
    editingText !== null && editingText.trim() !== '' &&
    observationFinalPackAmount(editingText) === null

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={invalid ? hintId : undefined}
        autoComplete="off"
        value={currentText}
        onFocus={() => setEditingText(observationEditablePackAmount(amount))}
        onChange={(event) => setEditingText(event.target.value)}
        onBlur={(event) => {
          // Draft auto-save receives a completed physical amount or null,
          // never an in-progress comma, exponent or rounded quantity.
          onAmountChange(observationFinalPackAmount(event.currentTarget.value))
          setEditingText(null)
        }}
      />
      {invalid && (
        <small role="status" id={hintId}>
          Vul een positieve verpakkingshoeveelheid in, bijvoorbeeld 0,75.
          Gebruik geen duizendtallen of een afgebroken decimaal.
        </small>
      )}
    </>
  )
}
