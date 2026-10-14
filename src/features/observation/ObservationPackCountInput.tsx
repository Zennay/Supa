import { useId, useState } from 'react'

/**
 * Parse an explicitly observed positive item count without rounding,
 * truncating, interpreting exponents or substituting the default of one.
 */
export function observationExactPackCount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0*[1-9][0-9]*$/.test(value.trim())) {
    return null
  }
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function ObservationPackCountInput({
  count,
  label,
  onCountChange,
}: {
  count: number
  label: string
  onCountChange: (count: number) => void
}) {
  const hintId = useId()
  const [editing, setEditing] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)
  const invalidWhileTyping =
    editing !== null && editing.trim() !== '' &&
    observationExactPackCount(editing) === null
  const invalid = invalidWhileTyping || rejected

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={invalid ? hintId : undefined}
        autoComplete="off"
        value={editing ?? (Number.isSafeInteger(count) && count > 0 ? String(count) : '')}
        onFocus={() => {
          setEditing(Number.isSafeInteger(count) && count > 0 ? String(count) : '')
          setRejected(false)
        }}
        onChange={(event) => {
          setEditing(event.target.value)
          setRejected(false)
        }}
        onBlur={(event) => {
          const accepted = observationExactPackCount(event.currentTarget.value)
          // Invalid attempts never rewrite an actual observation as a rounded,
          // truncated or fabricated default count. Keep the previous saved value.
          if (accepted === null) {
            setRejected(true)
          } else {
            setRejected(false)
            if (accepted !== count) onCountChange(accepted)
          }
          setEditing(null)
        }}
      />
      {invalid && (
        <small role="status" id={hintId}>
          Vul een heel, positief aantal in (bijvoorbeeld 2).
          Ongeldige invoer is niet opgeslagen; het eerdere aantal blijft staan.
        </small>
      )}
    </>
  )
}
