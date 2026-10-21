import { useState } from 'react'

/** Human-entered source text, never permission evidence or an accepted price. */
export function PrivateCapturePastePreview({
  disabled, onPreview,
}: {
  disabled: boolean
  onPreview: (sources: string[]) => void
}) {
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [error, setError] = useState('')
  const maxBytes = 256000
  const available = (value: string) => value.trim().length > 0
  function submit(values: string[]) {
    setError('')
    if (disabled) return
    try {
      if (values.length < 1 || values.length > 2 ||
          values.some(value => !available(value))) {
        throw Error('Vul één of twee originele winkelbladen in.')
      }
      if (values.some(value => new TextEncoder().encode(value).length > maxBytes)) {
        throw Error('Elk bronblad mag maximaal 256 kB zijn.')
      }
      // The existing full CSV parser independently identifies PLUS or Deka,
      // refuses duplicates and validates every physical fact and timestamp.
      onPreview(values)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bronblad ongeldig.')
    }
  }
  return <details className="offline-price-workbench__capture-paste">
    <summary>Of plak één of twee ingevulde prijsbladen rechtstreeks uit Excel</summary>
    <p>Plak de volledige negenkoloms Supa-CSV (inclusief de kolomkoppen) of de
      tab-gescheiden tabel uit Excel/Calc. De labels hieronder bewijzen géén
      winkelidentiteit: Supa bepaalt die uitsluitend uit de bronkolommen.
      Je kunt de afzonderlijke winkels of allebei vooraf bekijken.
      Er worden geen prijzen automatisch geaccepteerd.</p>
    <label>Eerste originele winkelbron
      <textarea rows={5} spellCheck={false} maxLength={256000}
        value={first} onChange={event => setFirst(event.currentTarget.value)}
        placeholder="retailer;observedAt;id;name;packAmount;packUnit;packCount;priceCents;available" />
    </label>
    <label>Tweede originele winkelbron (optioneel)
      <textarea rows={5} spellCheck={false} maxLength={256000}
        value={second} onChange={event => setSecond(event.currentTarget.value)}
        placeholder="Tweede onafhankelijke bronopname, inclusief kopregel" />
    </label>
    <div className="offline-price-workbench__capture-paste-actions">
      <button type="button" disabled={disabled || !available(first)}
        onClick={() => submit([first])}>Controleer eerste bron</button>
      <button type="button" disabled={disabled || !available(second)}
        onClick={() => submit([second])}>Controleer tweede bron</button>
      <button type="button" disabled={disabled || !available(first) || !available(second)}
        onClick={() => submit([first, second])}>Controleer beide winkels samen</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <small>De voorinzage verwerkt dit uitsluitend lokaal; originele bronmomenten,
      betaalde hele pakken, beschikbaarheid en onbekende prijzen worden door de
      bestaande importcontrole beoordeeld. Bevestig overname afzonderlijk.</small>
  </details>
}
