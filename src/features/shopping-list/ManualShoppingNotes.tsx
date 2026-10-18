import { useEffect, useRef, useState, type FormEvent, type Dispatch, type SetStateAction } from 'react'
import './manualShoppingNotes.css'
import { mergePrivateNotes, normalizePrivateNotes, serializePrivateNotes, PRIVATE_NOTES_BACKUP_MAX_BYTES } from './manualShoppingNotesBackup.ts'
import type { OneStoreBasket } from '../../domain/basket.ts'
import { combinedPrivateTripText, type PrivateLooseProduct } from './combinedPrivateTrip.ts'

export type UnpricedShoppingNote = { id: string; label: string; store: 'Algemeen' | 'PLUS' | 'DekaMarkt'; done: boolean }
type SetNotes = Dispatch<SetStateAction<UnpricedShoppingNote[]>>
const stores = ['Algemeen', 'PLUS', 'DekaMarkt'] as const
const safeLabel = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/g, ' ').trim()

/** Private volatile notes; no product match, price or retailer-source authority. */
export function ManualShoppingNotes({ notes, setNotes, storeBasket = null,
  activeStore = 'PLUS', sourceFresh = false, ownExtras = [],
  observedAt = null, tripProgress,
}: {
  notes: UnpricedShoppingNote[]
  setNotes: SetNotes
  storeBasket?: OneStoreBasket | null
  activeStore?: 'PLUS' | 'DekaMarkt'
  sourceFresh?: boolean
  ownExtras?: readonly PrivateLooseProduct[]
  observedAt?: string | null
  tripProgress?: Readonly<{ identity: string; done: string[] }>
}) {
  const [name, setName] = useState('')
  const [bulkDraft, setBulkDraft] = useState('')
  const [store, setStore] = useState<UnpricedShoppingNote['store']>('Algemeen')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [filterStore, setFilterStore] = useState<'Alle winkels' | UnpricedShoppingNote['store']>('Alle winkels')
  const [exportVisible, setExportVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [combinedCopyVisible, setCombinedCopyVisible] = useState(false)
  const [combinedStore, setCombinedStore] = useState<'PLUS' | 'DekaMarkt'>(activeStore)
  useEffect(() => { setCombinedStore(activeStore); setCombinedCopyVisible(false) }, [activeStore])
  const combinedText = combinedPrivateTripText({
    basket: combinedStore === activeStore ? storeBasket : null,
    store: combinedStore, sourceFresh: combinedStore === activeStore && sourceFresh,
    notes, extras: combinedStore === activeStore ? ownExtras : [],
    observedAt: combinedStore === activeStore ? observedAt : null,
    tripProgress: combinedStore === activeStore ? tripProgress : undefined,
  })
  function downloadCombinedTrip() {
    if (!combinedText) return
    const url = URL.createObjectURL(new Blob([combinedText], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-mijn-complete-' + combinedStore.toLowerCase() + '-lijst.txt'
      document.body.append(link); link.click(); link.remove()
      setMessage('Je complete privéwinkeltrip voor ' + combinedStore + ' is lokaal gedownload.')
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }

  const [backupPreview, setBackupPreview] = useState<UnpricedShoppingNote[] | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const readVersion = useRef(0)
  function backupDownload() {
    try {
      const json = serializePrivateNotes(notes)
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-eigen-ongeprijsde-lijst-backup.json'
        document.body.append(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage('Je hele ongeprijsde lijst is lokaal als JSON-backup opgeslagen.')
    } catch { setMessage('Kon deze privéboodschappen niet als backup opslaan.') }
  }
  async function backupRead(file?: File) {
    const version = ++readVersion.current
    setBackupPreview(null)
    if (!file) return
    setBackupBusy(true)
    try {
      if (file.size > PRIVATE_NOTES_BACKUP_MAX_BYTES) throw new Error('Backup is groter dan 64 kB.')
      const bytes = await file.arrayBuffer()
      if (version !== readVersion.current) return
      if (bytes.byteLength > PRIVATE_NOTES_BACKUP_MAX_BYTES) throw new Error('Backup is te groot.')
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const parsed = normalizePrivateNotes(JSON.parse(source))
      const merged = mergePrivateNotes(notes, parsed)
      setBackupPreview(parsed)
      setMessage(merged.added + ' nieuwe boodschappen gevonden. Controleer en bevestig de import.')
    } catch (error) {
      if (version === readVersion.current) setMessage(error instanceof Error ? error.message : 'Kon backup niet inlezen.')
    } finally { if (version === readVersion.current) setBackupBusy(false) }
  }
  function backupConfirm() {
    if (!backupPreview) return
    try {
      const merged = mergePrivateNotes(notes, backupPreview)
      setNotes(current => {
        try { return mergePrivateNotes(current, backupPreview).notes }
        catch { return current }
      })
      setBackupPreview(null)
      setMessage(merged.added + ' boodschappen toegevoegd; bestaande items en vinkjes behouden.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import geweigerd.')
    }
  }

  function addBulk(event: FormEvent) {
    event.preventDefault()
    // Human-authored lines, not supermarket product identities or price data.
    const parsed = bulkDraft.split(/\r?\n/u)
      .map(line => safeLabel(line.replace(/^(?:[-*•]\s+|☐\s+|\d{1,3}[.)]\s+)/u, '')))
      .filter(Boolean)
    if (!parsed.length || parsed.some(line => line.length > 140) ||
        parsed.length > 100 || notes.length + parsed.length > 100) {
      setMessage('Controleer de geplakte lijst: maximaal 100 artikelen totaal en 140 tekens per regel.')
      return
    }
    const appended = parsed.map(label => ({
      id: 'own-note-' + crypto.randomUUID(), label, store, done: false,
    }))
    setNotes(current => current.length + appended.length > 100 ? current : [...current, ...appended])
    setBulkDraft('')
    setMessage(parsed.length + ' eigen artikelen toegevoegd aan ' + store +
      ', zonder prijzen of invloed op je winkelvergelijking.')
  }
  function add(event: FormEvent) {
    event.preventDefault()
    const label = safeLabel(name)
    if (!label || label.length > 140 || notes.length >= 100) {
      setMessage('Vul een geldige omschrijving in (max. 140 tekens en 100 artikelen).')
      return
    }
    setNotes(current => current.length >= 100 ? current : [...current,
      { id: `own-note-${crypto.randomUUID()}`, label, store, done: false }])
    setName('')
    setMessage(`${label} toegevoegd zonder prijs. Dit verandert de supermarktvergelijking niet.`)
  }
  const selected = notes.filter(note => filterStore === 'Alle winkels' ||
    note.store === filterStore || note.store === 'Algemeen')
  const visible = onlyOpen ? selected.filter(note => !note.done) : selected
  const exportText = [
    'SUPA · EIGEN ONGEPRIJSDE BOODSCHAPPEN · ' + filterStore,
    'Los van Planner, bronopnames, weekbudget en winkelmandtotalen.', '',
    ...selected.map(note => (note.done ? '☑ ' : '☐ ') + `[${note.store}] ${safeLabel(note.label)} · prijs onbekend`),
    '', 'Geen winkelprijs, bronrecht of besparingsclaim.',
  ].join('\n') + '\n'
  function download() {
    const uri = URL.createObjectURL(new Blob([exportText], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = uri
      link.download = 'supa-mijn-ongeprijsde-boodschappen.txt'
      document.body.append(link); link.click(); link.remove()
      setMessage('Je ongeprijsde boodschappen zijn als privélijst gedownload.')
    } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
  }
  return <section className="manual-shopping-notes" aria-label="Mijn ongeprijsde boodschappen">
    <h2>Zelf toevoegen, zonder prijs</h2>
    <p>Ook zonder prijsbestanden boodschappen toevoegen. Alleen tijdelijk in dit tabblad;
      nooit meegenomen in weekbudget, twee winkelmanden of prijsverschil.</p>
    <form onSubmit={add} className="manual-shopping-notes__add">
      <label>Wat wil je meenemen?<input value={name} maxLength={140} autoComplete="off"
        placeholder="Bijv. vuilniszakken" onChange={event => setName(event.target.value)} /></label>
      <label>Winkellijst<select value={store} onChange={event => setStore(event.target.value as typeof store)}>
        {stores.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <button type="submit" disabled={notes.length >= 100}>+ Voeg toe</button>
    </form>
    <details className="manual-shopping-notes__bulk">
      <summary>Plak meerdere boodschappen tegelijk</summary>
      <form onSubmit={addBulk}>
        <p>Eén eigen artikel per regel, eventueel voorafgegaan door een opsommingsteken.
          Alle regels gaan naar de hierboven gekozen winkellijst ({store}).
          Geen productmatching of automatische prijzen.</p>
        <label>Je ongeprijsde boodschappen
          <textarea rows={5} maxLength={15000} value={bulkDraft}
            placeholder={'Vuilniszakken\nAfwasmiddel\nToiletpapier'}
            onChange={event => setBulkDraft(event.target.value)} />
        </label>
        <button type="submit" disabled={!bulkDraft.trim() || notes.length >= 100}>
          Voeg regels toe aan mijn lijst
        </button>
      </form>
    </details>
    <div className="manual-shopping-notes__top">
      <strong>{notes.length} eigen {notes.length === 1 ? 'artikel' : 'artikelen'} · {notes.filter(n => n.done).length} afgevinkt</strong>
      <label>Toon winkellijst
        <select value={filterStore} onChange={event => setFilterStore(event.target.value as typeof filterStore)}>
          <option value="Alle winkels">Alle winkels</option>
          {stores.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label><input type="checkbox" checked={onlyOpen} onChange={event => setOnlyOpen(event.target.checked)} /> Alleen open</label>
    </div>
    <ul>{visible.map(note => <li key={note.id}>
      <label><input type="checkbox" checked={note.done}
        onChange={() => setNotes(current => current.map(item => item.id === note.id
          ? { ...item, done: !item.done } : item))} />
        <span>{note.label} <small>· {note.store} · prijs onbekend</small></span></label>
      <button type="button" onClick={() => setNotes(current => current.filter(item => item.id !== note.id))}
        aria-label={`Verwijder ${note.label}`}>Verwijder</button>
    </li>)}</ul>
    {selected.length === 0 && <p role="status">Nog geen boodschappen in deze selectie. De lijst werkt zonder winkelprijzen.</p>}
    <div className="manual-shopping-notes__actions">
      <button type="button" disabled={!selected.length} onClick={() => setExportVisible(value => !value)}>
        {exportVisible ? 'Verberg kopieertekst' : 'Toon kopieertekst'}</button>
      <button type="button" disabled={!selected.length} onClick={download}>Download lijst (TXT)</button>
      <button type="button" disabled={!notes.length} onClick={backupDownload}>Backup hele lijst (JSON)</button>
      <label>Herstel lijst uit JSON-backup (max. 64 kB)
        <input type="file" accept=".json,application/json" disabled={backupBusy}
          onChange={event => { void backupRead(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      </label>
    </div>
    {backupPreview && <div className="manual-shopping-notes__backup" role="group"
      aria-label="Voorbeeld van de boodschappenbackup">
      <strong>Privébackup klaar: {backupPreview.length} artikelen</strong>
      <p>Bestaande artikelen worden niet overschreven. Conflicterende IDs en meer
        dan 100 artikelen worden geweigerd. Niets wordt geüpload of geprijsd.</p>
      <button type="button" onClick={backupConfirm}>Bevestig toevoegen aan mijn lijst</button>
      <button type="button" onClick={() => { readVersion.current++; setBackupPreview(null) }}>
        Annuleer import
      </button>
    </div>}
    <section className="manual-shopping-notes__combined" aria-label="Complete winkeltrip exporteren">
      <h3>Eén complete lijst per winkel</h3>
      <label>Winkel voor download
        <select value={combinedStore} onChange={event => {
          setCombinedStore(event.target.value as 'PLUS' | 'DekaMarkt')
          setCombinedCopyVisible(false)
        }}>
          <option value="PLUS">PLUS</option>
          <option value="DekaMarkt">DekaMarkt</option>
        </select>
      </label>
      {combinedStore !== activeStore && storeBasket && <p role="status">
        Het ingeladen mandje hoort bij {activeStore}. Schakel de gekozen winkel in
        Lijst om voor {combinedStore} ook het eigen geprijsde mandje te exporteren.
      </p>}
      <p>Weekmenu, zelf gekozen losse winkelproducten en eigen algemene/{combinedStore}-notities
        in één bestand. Prijzen van extra artikelen blijven buiten weekbudget en
        PLUS/DekaMarkt-vergelijking. Bij verouderde invoer wordt dat vermeld.</p>
      <div className="manual-shopping-notes__actions">
        <button type="button" disabled={!combinedText} onClick={downloadCombinedTrip}>
          Download complete {combinedStore}-lijst (TXT)
        </button>
        <button type="button" disabled={!combinedText}
          onClick={() => setCombinedCopyVisible(value => !value)}>
          {combinedCopyVisible ? 'Verberg complete lijst' : 'Toon complete kopieertekst'}
        </button>
      </div>
      {!combinedText && <p role="status">Nog geen betrouwbare lijstregels voor deze winkel.
        Voeg eigen boodschappen toe of open Vergelijk voor je weekmand.</p>}
      {combinedCopyVisible && combinedText && <label>Kopieer complete {combinedStore}-lijst
        <textarea readOnly rows={12} value={combinedText}
          onFocus={event => event.currentTarget.select()} /></label>}
    </section>
    {exportVisible && <label>Kopieer mijn ongeprijsde boodschappen
      <textarea rows={Math.min(selected.length + 6, 15)} readOnly value={exportText}
        onFocus={event => event.currentTarget.select()} /></label>}
    <p role="status" aria-live="polite">{message}</p>
  </section>
}
