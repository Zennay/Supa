import { useRef, useState } from 'react'
import { parseOfflinePriceSnapshots, type OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import './plannerQuickSourcePaste.css'

type Preview = { raw: string; normalized: string; data: OfflinePriceSnapshots }
const limit = 256000
const dateText = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })

/** Local preview using the same converter and source contract as Vergelijk. */
export function PlannerQuickSourcePaste({ onImport, hasDemand }: {
  onImport: (files: File[]) => void
  hasDemand: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const revision = useRef(0)
  function changeDraft(raw: string) {
    ++revision.current
    setDraft(raw); setPreview(null); setBusy(false)
    setMessage(raw ? 'Concept gewijzigd. Controleer opnieuw voor import.' : '')
  }
  async function inspectSource(raw: string) {
    const ticket = ++revision.current
    setPreview(null); setMessage('')
    if (!raw.trim()) { setMessage('Plak eerst echte eigen CSV-, TSV- of JSON-bronregels.'); return }
    if (new TextEncoder().encode(raw).length > limit) {
      setMessage('Bron groter dan 256 kB. Splits de originele opnames op.'); return
    }
    setBusy(true)
    try {
      let normalized = raw
      if (!/^\s*\{/u.test(raw)) {
        const moduleUrl = import.meta.env.BASE_URL + 'offline-two-store-csv.mjs'
        const converter: unknown = await import(/* @vite-ignore */ moduleUrl)
        if (!converter || typeof converter !== 'object' ||
            !('convertOwnStoreCsv' in converter) ||
            typeof converter.convertOwnStoreCsv !== 'function')
          throw new Error('De bestaande lokale CSV-converter ontbreekt.')
        normalized = (converter.convertOwnStoreCsv as (input: string) => string)(raw)
      }
      if (ticket !== revision.current) return
      const data = parseOfflinePriceSnapshots(normalized, Date.now())
      setPreview({ raw, normalized, data })
      setMessage('Structuur lokaal herkend. Controleer de bronmomenten en prijsdekking.')
    } catch (cause) {
      if (ticket === revision.current)
        setMessage(cause instanceof Error ? cause.message : 'Bronindeling niet herkend.')
    } finally {
      if (ticket === revision.current) setBusy(false)
    }
  }
  async function inspect() { await inspectSource(draft) }

  async function previewOneFile(file: File | undefined) {
    if (!file) return
    const ticket = ++revision.current
    setPreview(null); setMessage('')
    if (file.size === 0 || file.size > limit) {
      setMessage('Kies één gevuld bronbestand van maximaal 256 kB.')
      return
    }
    setBusy(true)
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (ticket !== revision.current) return
      setDraft(raw)
      await inspectSource(raw)
    } catch {
      if (ticket === revision.current) setMessage('Bronbestand moet geldige UTF-8 CSV, TSV of JSON bevatten.')
    } finally {
      if (ticket === revision.current) setBusy(false)
    }
  }

  async function pasteClipboard() {
    const ticket = ++revision.current
    setPreview(null); setMessage('')
    try {
      if (!navigator.clipboard?.readText) throw new Error('Klembord niet beschikbaar')
      const raw = await navigator.clipboard.readText()
      if (ticket !== revision.current) return
      if (new TextEncoder().encode(raw).length > limit)
        throw new Error('Klembord groter dan 256 kB.')
      setDraft(raw)
      setMessage('Gekopieerde bron lokaal geplakt. Controleer hem voor import.')
    } catch {
      if (ticket === revision.current)
        setMessage('Klembord niet beschikbaar. Plak handmatig in het tekstvak.')
    }
  }
  function handoff() {
    if (!preview || preview.raw !== draft) return
    try {
      const current = parseOfflinePriceSnapshots(preview.normalized, Date.now())
      // Old sources may still be inspected or renewed. Only the canonical
      // Workbench can admit an amount into a current complete basket.
      if (!current.currentEnough) {
        setMessage('Oude opname: in Vergelijk alleen voor broncontrole of vernieuwing; geen actueel prijsverschil.')
      }
      const file = new File([preview.normalized], 'supa-eigen-winkelbron.json',
        { type: 'application/json' })
      if (file.size > limit) throw new Error('Genormaliseerde bron te groot.')
      onImport([file])
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Importeren niet mogelijk.')
    }
  }
  return <details className="supa-planner-source-paste" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Plak winkelprijzen vanuit spreadsheet of JSON</summary>
    {open && <>
      <p>Gebruik alleen zelf rechtmatig verkregen PLUS/Deka-productdata. Plak de negen
        Supa-kolommen als CSV, puntkomma-CSV of tabgescheiden spreadsheet, of
        eigen JSON met één of beide winkels. Alles wordt lokaal gecontroleerd:
        een geldige import bewijst geen bronrechten of actuele winkelprijzen.</p>
      <label>Of bekijk eerst één eigen CSV-, TSV- of JSON-bestand
        <input type="file" accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json"
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            void previewOneFile(file)
          }} />
        <small>Een bestand met beide winkels mag ook. Twee aparte bestanden selecteer je bovenaan met de directe bestandskiezer.</small>
      </label>
      <button type="button" className="ghost-button" onClick={() => void pasteClipboard()}>
        Plak uit mijn klembord
      </button>
      <label>Originele winkelregels
        <textarea rows={7} value={draft} spellCheck={false} maxLength={256000}
          placeholder="retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available"
          onChange={event => changeDraft(event.currentTarget.value)} />
      </label>
      <button type="button" disabled={busy || !draft.trim()} onClick={() => void inspect()}>
        {busy ? 'Bron wordt lokaal gelezen…' : 'Controleer mijn winkelbron'}
      </button>
      {message && <p role="status" aria-live="polite">{message}</p>}
      {preview && <div className="supa-planner-source-paste__preview">
        <strong>{Object.keys(preview.data.captures).length} eigen winkelopname(s) gevonden</strong>
        {(['PLUS', 'DekaMarkt'] as const).map(store => {
          const capture = preview.data.captures[store]
          if (!capture) return <p key={store}>{store}: geen bron; geen prijs beschikbaar.</p>
          const priced = capture.products.filter(p => p.sourceAvailable === true &&
            p.sourcePriceCents !== null && p.packAmount !== null).length
          return <section key={store}>
            <h4>{store}</h4>
            <p>{capture.products.length} originele SKU's;
              {' '}{priced} met vastgelegde (niet per se actuele) pakprijs en
              {' '}{capture.products.length - priced} zonder bruikbare prijs.</p>
            <small>Oorspronkelijk bronmoment: {dateText.format(new Date(capture.observedMs))}</small>
          </section>
        })}
        <p>{!preview.data.currentEnough
          ? 'Oude of toekomstige bron. Vernieuw je werkelijke waarnemingen.'
          : preview.data.pairedWithin24h
            ? 'Beide opnames binnen 24 uur; SKU, pakken en volledige mand nog te controleren.'
            : Object.keys(preview.data.captures).length === 2
              ? 'Bronmomenten meer dan 24 uur uiteen: geen volledig prijsverschil mogelijk.'
              : 'Nog maar één winkelbron. De andere winkel blijft ongeprijsd.'}</p>
        <button type="button" disabled={!hasDemand}
          onClick={handoff}>Open mijn bron in Vergelijk voor productmatching</button>
        {!hasDemand && <small>Kies eerst recepten in je Planner-weekmenu.</small>}
      </div>}
    </>}
  </details>
}
