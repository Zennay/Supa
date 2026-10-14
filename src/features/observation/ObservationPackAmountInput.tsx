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
  const text = String(amount)
  // JavaScript stringifies tiny finite decimals using exponents. Expand them
  // without rounding, otherwise focusing and blurring an existing observation
  // would inadvertently turn its value into null.
  const tiny = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(text)
  if (tiny) {
    const digits = tiny[1] + (tiny[2] ?? '')
    return `0,${'0'.repeat(Number(tiny[3]) - 1)}${digits}`
  }
  return text.replace('.', ',')
}

/** A malformed quantity must not erase a previously observed package measurement. */
export function observationPackAmountEditDecision(
  text: unknown,
): { kind: 'accept'; value: number | null } | { kind: 'reject' } {
  if (typeof text !== 'string') return { kind: 'reject' }
  if (!text.trim()) return { kind: 'accept', value: null }
  const parsed = observationFinalPackAmount(text)
  return parsed === null ? { kind: 'reject' } : { kind: 'accept', value: parsed }
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
  const [rejected, setRejected] = useState(false)
  const currentText = editingText ?? observationEditablePackAmount(amount)
  const invalid = rejected || (
    editingText !== null && editingText.trim() !== '' &&
    observationFinalPackAmount(editingText) === null
  )

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
        onFocus={() => {
          setEditingText(observationEditablePackAmount(amount))
          setRejected(false)
        }}
        onChange={(event) => {
          setEditingText(event.target.value)
          setRejected(false)
        }}
        onBlur={(event) => {
          // Draft auto-save receives a completed physical amount or null,
          // never an in-progress comma, exponent or rounded quantity.
          const decision = observationPackAmountEditDecision(event.currentTarget.value)
          if (decision.kind === 'accept') {
            if (decision.value !== amount) onAmountChange(decision.value)
            setRejected(false)
          } else {
            setRejected(true)
          }
          setEditingText(null)
        }}
      />
      {invalid && (
        <small role="status" id={hintId}>
          Vul een positieve verpakkingshoeveelheid in, bijvoorbeeld 0,75.
          Gebruik geen duizendtallen of een afgebroken decimaal. Ongeldige invoer is niet opgeslagen; een eerder gemeten hoeveelheid blijft behouden.
        </small>
      )}
    </>
  )
}
