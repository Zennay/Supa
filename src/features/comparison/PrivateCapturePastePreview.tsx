import { useRef, useState } from 'react'
import { readLocalCaptureDraftFiles } from './readLocalCaptureDraftFiles.ts'

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
  function confirmReplacingDrafts(target: 'first' | 'second' | 'both',
    next: readonly string[]): boolean {
    const replaceFirst = target === 'both' || target === 'first'
    const replaceSecond = target === 'both' || target === 'second'
    const oldFirst = first
    const oldSecond = second
    const newFirst = target === 'both' || target === 'first' ? next[0] : ''
    const newSecond = target === 'both' ? next[1] : next[0]
    if (!(replaceFirst && available(oldFirst) && oldFirst !== newFirst) &&
        !(replaceSecond && available(oldSecond) && oldSecond !== newSecond)) return true
    // Browser-native explicit consent protects unsaved source captures.
    // Never silently discard an existing manually edited shop draft.
    return window.confirm('Je hebt al een ingevuld winkelconcept. Het openen van dit bestand ' +
      'vervangt de tekst in het gekozen invoerveld. Bewaar je huidige concept ' +
      'eerst als TXT als je het wilt behouden. Toch vervangen?')
  }
  async function readSavedDrafts(files: readonly File[], target: 'first' | 'second' | 'both') {
    if (disabled) return
    const request = ++latestRead.current
    setError('')
    setFeedback('')
    try {
      if (files.length !== (target === 'both' ? 2 : 1)) {
        throw Error(target === 'both' ? 'Selecteer precies twee bronbestanden.' : 'Kies precies één bronbestand.')
      }
      const drafts = await readLocalCaptureDraftFiles(files)
      if (request !== latestRead.current || !canRead.current) return
      // Never overwrite an edited or unsaved original without explicit consent.
      if (!confirmReplacingDrafts(target, drafts)) {
        setFeedback('Bronconcept behouden. Het gekozen bestand is niet overgenomen.')
        return
      }
      // Stage only; do not accept any prices or infer which store supplied them.
      onDraftChange()
      if (target === 'both') { setFirst(drafts[0]); setSecond(drafts[1]) }
      else if (target === 'first') setFirst(drafts[0])
      else setSecond(drafts[0])
      setFeedback('Lokale originele bron ingelezen. Bekijk beide tekstvakken en kies daarna zelf Bron controleren; er is niets geaccepteerd.')
    } catch (cause) {
      if (request !== latestRead.current || !canRead.current) return
      setError(cause instanceof Error ? cause.message : 'Kan het lokale bronbestand niet lezen.')
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
      if (!confirmReplacingDrafts(target, [raw])) {
        setFeedback('Bronconcept behouden. Het klembord is niet overgenomen.')
        return
      }
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
  function filePicker(target: 'first' | 'second' | 'both') {
    return <input type="file" disabled={disabled} multiple={target === 'both'}
      accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
      onChange={event => {
        const selected = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        // User selects the files explicitly. Contents remain local.
        if (selected.length) void readSavedDrafts(selected, target)
      }} />
  }
  return <details className="offline-price-workbench__capture-paste">
    <summary>Open of plak één of twee originele winkelbladen uit Excel/Calc</summary>
    <p>Plak de volledige negenkoloms Supa-CSV (inclusief de kolomkoppen) of de
      tab-gescheiden tabel uit Excel/Calc. De labels hieronder bewijzen géén
      winkelidentiteit: Supa bepaalt die uitsluitend uit de bronkolommen.
      Je kunt de afzonderlijke winkels of allebei vooraf bekijken.
      Excel/Calc <strong>Unicode Text</strong> wordt ook gelezen als een lokaal
      <code>.txt</code>- of <code>.tsv</code>-bestand met een expliciete UTF-16 LE/BE-BOM;
      gewone CSV blijft UTF-8. Er worden geen prijzen automatisch geaccepteerd.
      Klembordtoegang gebeurt uitsluitend na klikken en browsertoestemming.</p>
    <label>Open beide lokale winkelbestanden tegelijk (CSV, TSV of TXT)
      {filePicker('both')}
    </label>
    <small>De volgorde vult uitsluitend het eerste en tweede invoerveld.
      PLUS/DekaMarkt wordt later uit de oorspronkelijke bronkolommen gecontroleerd.</small>
    <label>Eerste originele winkelbron
      <textarea rows={5} spellCheck={false} maxLength={256000}
        value={first} disabled={disabled} onChange={event => {
          ++latestRead.current; setFeedback(''); onDraftChange(); setFirst(event.currentTarget.value)
        }}
        placeholder="retailer;observedAt;id;name;packAmount;packUnit;packCount;priceCents;available" />
    </label>
    <label>Of open een lokaal bestand voor de eerste bron
      {filePicker('first')}
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
    <label>Of open een lokaal bestand voor de tweede bron
      {filePicker('second')}
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
