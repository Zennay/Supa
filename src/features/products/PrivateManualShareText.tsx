import { useRef, useState } from 'react'
import { selectWeekMenuText, weekMenuSelectionFeedback } from '../planner/selectWeekMenuText.ts'

/**
 * Manual, user-controlled local copying of private shopping data.
 * No Clipboard API, device-share permission, storage or network request.
 * Parent must admit and recheck the exact current source before rendering.
 */
export function PrivateManualShareText({ text, label }: { text: string; label: string }) {
  const field = useRef<HTMLTextAreaElement>(null)
  const [message, setMessage] = useState<{ text: string; result: string } | null>(null)
  function select() {
    const selected = selectWeekMenuText(field.current, text)
    setMessage({ text, result: weekMenuSelectionFeedback(selected) })
  }
  return <div className="private-reviewed-products__manual-copy">
    <strong>{label}</strong>
    <p>Deze tekst blijft in je browser. Kies zelf kopiëren of delen via het
      kopieermenu van je apparaat; Supa gebruikt geen automatische klembord- of deeltoegang.</p>
    <button type="button" onClick={select}>Selecteer alle tekst om zelf te kopiëren</button>
    <textarea ref={field} readOnly rows={9} value={text}
      aria-label={label + ' · selecteerbare privétekst'}
      onFocus={event => event.currentTarget.select()} />
    {message?.text === text && <p role="status">{message.result}</p>}
  </div>
}
