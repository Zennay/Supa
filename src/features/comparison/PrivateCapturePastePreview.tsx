import { useRef, useState } from 'react'

/** Human-entered source text, never permission evidence or an accepted price. */
export function PrivateCapturePastePreview({
  disabled, onPreview, onDraftChange,
}: {
  disabled: boolean
  onPreview: (sources: string[]) => void
  onDraftChange: () => void
}) {
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const maxBytes = 256000
  const latestRead = useRef(0)
  const canRead = useRef(!disabled)
  canRead.current = !disabled
  const available = (value: string) => value.trim().length > 0
  function submit(values: string[]) {
    setError('')
    setFeedback('')
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
  function downloadDraft(raw: string, index: 1 | 2) {
    setError('')
    setFeedback('')
    try {
      if (disabled || !available(raw)) throw Error('Er is geen eigen bronconcept om te bewaren.')
      if (new TextEncoder().encode(raw).length > maxBytes)
        throw Error('Bronconcept is groter dan 256 kB; maak een kleiner bestand.')
      // This is the unmodified human text, NOT a successful source admission.
      const uri = URL.createObjectURL(new Blob([raw], { type: 'text/plain;charset=utf-8' }))
      try {
        const a = document.createElement('a')
        a.href = uri
        a.download = 'supa-origineel-winkelconcept-' + index + '-niet-gecontroleerd.txt'
        document.body.append(a)
        try { a.click() } finally { a.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
      setFeedback('Origineel concept lokaal bewaard. Dit bestand is nog geen geldige import of bronbewijs; controleer en bevestig later de prijzen opnieuw.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kon het lokale concept niet bewaren.')
    }
  }
  async function readSpreadsheetClipboard(target: 'first' | 'second') {
    // Only a user gesture may access the clipboard. This is a local, untrusted
    // draft; never apply source prices or infer the retailer at this stage.
    if (disabled) return
    const request = ++latestRead.current
    setError('')
    setFeedback('')
    try {
      if (!navigator.clipboard?.readText) throw Error(
        'Klembord lezen is hier niet beschikbaar. Plak je spreadsheet zelf in het tekstvak.')
      const raw = await navigator.clipboard.readText()
      if (request !== latestRead.current || !canRead.current) return
      if (!available(raw)) throw Error('Het klembord bevat geen ingevuld winkelblad.')
      if (raw.length > 256000 || new TextEncoder().encode(raw).length > maxBytes)
        throw Error('Het klembord bevat meer dan 256 kB. Gebruik een kleiner winkelblad.')
      onDraftChange()
      if (target === 'first') setFirst(raw)
      else setSecond(raw)
      setFeedback('Klembord lokaal ingevuld. Controleer de bronvelden en kies daarna bewust de voorinzage; er is nog niets geïmporteerd.')
    } catch (cause) {
      if (request !== latestRead.current || !canRead.current) return
      setError(cause instanceof Error && cause.name === 'NotAllowedError'
        ? 'Geen klembordtoestemming. Je kunt de tabel altijd handmatig plakken.'
        : cause instanceof Error ? cause.message : 'Kon de tabel niet lezen. Plak hem handmatig.')
    }
  }
  return <details className="offline-price-workbench__capture-paste">
    <summary>Of plak één of twee ingevulde prijsbladen rechtstreeks uit Excel</summary>
    <p>Plak de volledige negenkoloms Supa-CSV (inclusief de kolomkoppen) of de
      tab-gescheiden tabel uit Excel/Calc. De labels hieronder bewijzen géén
      winkelidentiteit: Supa bepaalt die uitsluitend uit de bronkolommen.
      Je kunt de afzonderlijke winkels of allebei vooraf bekijken.
      Er worden geen prijzen automatisch geaccepteerd. Klembordtoegang gebeurt uitsluitend na klikken en browsertoestemming.</p>
    <label>Eerste originele winkelbron
      <textarea rows={5} spellCheck={false} maxLength={256000}
        value={first} disabled={disabled} onChange={event => {
          ++latestRead.current; setFeedback(''); onDraftChange(); setFirst(event.currentTarget.value)
        }}
        placeholder="retailer;observedAt;id;name;packAmount;packUnit;packCount;priceCents;available" />
    </label>
    <button type="button" className="ghost-button" disabled={disabled}
      onClick={() => void readSpreadsheetClipboard('first')}>
      Lees gekopieerde Excel-/CSV-tabel in eerste concept (na toestemming)
    </button>
    <button type="button" className="ghost-button" disabled={disabled || !available(first)}
      onClick={() => downloadDraft(first, 1)}>
      Bewaar eerste ongecontroleerde bronconcept lokaal (TXT)
    </button>
    <label>Tweede originele winkelbron (optioneel)
      <textarea rows={5} spellCheck={false} maxLength={256000}
        value={second} disabled={disabled} onChange={event => {
          ++latestRead.current; setFeedback(''); onDraftChange(); setSecond(event.currentTarget.value)
        }}
        placeholder="Tweede onafhankelijke bronopname, inclusief kopregel" />
    </label>
    <button type="button" className="ghost-button" disabled={disabled}
      onClick={() => void readSpreadsheetClipboard('second')}>
      Lees gekopieerde tabel in tweede concept (na toestemming)
    </button>
    <button type="button" className="ghost-button" disabled={disabled || !available(second)}
      onClick={() => downloadDraft(second, 2)}>
      Bewaar tweede ongecontroleerde bronconcept lokaal (TXT)
    </button>
    <div className="offline-price-workbench__capture-paste-actions">
      <button type="button" disabled={disabled || !available(first)}
        onClick={() => submit([first])}>Controleer eerste bron</button>
      <button type="button" disabled={disabled || !available(second)}
        onClick={() => submit([second])}>Controleer tweede bron</button>
      <button type="button" disabled={disabled || !available(first) || !available(second)}
        onClick={() => submit([first, second])}>Controleer beide winkels samen</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status" aria-live="polite">{feedback}</p>}
    <small>De voorinzage verwerkt dit uitsluitend lokaal; originele bronmomenten,
      betaalde hele pakken, beschikbaarheid en onbekende prijzen worden door de
      bestaande importcontrole beoordeeld. Bevestig overname afzonderlijk.</small>
  </details>
}
