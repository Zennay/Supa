import { useEffect, useRef, useState, type FormEvent, type Dispatch, type SetStateAction } from 'react'
import './manualShoppingNotes.css'
import { mergePrivateNotes, normalizePrivateNotes, serializePrivateNotes, PRIVATE_NOTES_BACKUP_MAX_BYTES } from './manualShoppingNotesBackup.ts'

export type UnpricedShoppingNote = { id: string; label: string; store: 'Algemeen' | 'PLUS' | 'DekaMarkt'; done: boolean }
type SetNotes = Dispatch<SetStateAction<UnpricedShoppingNote[]>>
const stores = ['Algemeen', 'PLUS', 'DekaMarkt'] as const
const privateSessionKey = 'supa:unpriced-notes:session:v1'
const safeLabel = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/g, ' ').trim()
const duplicateKey = (store: UnpricedShoppingNote['store'], label: string) =>
  JSON.stringify([store, label.normalize('NFC').toLocaleLowerCase('nl-NL')])

/** Private volatile notes; no product match, price or retailer-source authority. */
export function ManualShoppingNotes({ notes, setNotes }: {
  notes: UnpricedShoppingNote[]
  setNotes: SetNotes
}) {
  const [name, setName] = useState('')
  const [bulkDraft, setBulkDraft] = useState('')
  const [store, setStore] = useState<UnpricedShoppingNote['store']>('Algemeen')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [filterStore, setFilterStore] = useState<'Alle winkels' | UnpricedShoppingNote['store']>('Alle winkels')
  const [exportVisible, setExportVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [lastRemoved, setLastRemoved] = useState<{ note: UnpricedShoppingNote; index: number } | null>(null)
  const [editing, setEditing] = useState<{ id: string; initialLabel: string;
    initialStore: UnpricedShoppingNote['store']; label: string;
    store: UnpricedShoppingNote['store'] } | null>(null)
  const [sessionEnabled, setSessionEnabled] = useState(false)
  const [sessionProtected, setSessionProtected] = useState(false)
  const [sessionRaw, setSessionRaw] = useState<string | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')
  // A stored record exists only after a previous explicit user opt-in.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(privateSessionKey)
      if (raw === null) return
      if (new TextEncoder().encode(raw).length > PRIVATE_NOTES_BACKUP_MAX_BYTES) throw Error('size')
      const restored = normalizePrivateNotes(JSON.parse(raw))
      if (notes.length !== 0 && serializePrivateNotes(notes) !== serializePrivateNotes(restored)) {
        throw Error('different-current-list')
      }
      if (notes.length === 0) setNotes(current => current.length ? current : restored)
      setSessionRaw(raw)
      setSessionEnabled(true)
      setSessionMessage('Je eerder bewust bewaarde lijst is uit dit browsertabblad hersteld.')
    } catch {
      setSessionProtected(true)
      setSessionMessage('Onbekende of afwijkende sessielijst blijft onaangeroerd. Gebruik de JSON-backup.')
    }
  }, [])
  useEffect(() => {
    if (!sessionEnabled || sessionProtected) return
    try {
      const raw = window.sessionStorage.getItem(privateSessionKey)
      if (raw !== sessionRaw) {
        setSessionProtected(true)
        setSessionEnabled(false)
        setSessionMessage('Sessielijst is elders gewijzigd; er is niets overschreven.')
        return
      }
      const next = serializePrivateNotes(notes)
      if (new TextEncoder().encode(next).length > PRIVATE_NOTES_BACKUP_MAX_BYTES) throw Error('size')
      if (raw !== next) window.sessionStorage.setItem(privateSessionKey, next)
      if (sessionRaw !== next) setSessionRaw(next)
    } catch {
      setSessionEnabled(false)
      setSessionProtected(true)
      setSessionMessage('Opslaan in dit tabblad is geweigerd; download je JSON-backup.')
    }
  }, [sessionEnabled, sessionProtected, sessionRaw, notes])
  function changeSessionOptIn(checked: boolean) {
    if (sessionProtected) return
    try {
      const actual = window.sessionStorage.getItem(privateSessionKey)
      if (actual !== sessionRaw) {
        setSessionProtected(true)
        setSessionEnabled(false)
        setSessionMessage('Een andere sessielijst blijft beschermd tegen overschrijven.')
        return
      }
      if (!checked && actual !== null) window.sessionStorage.removeItem(privateSessionKey)
      setSessionEnabled(checked)
      if (!checked) setSessionRaw(null)
      setSessionMessage(checked
        ? 'Optioneel bewaren aan. Alleen in deze browsertab; geen server of prijzen.'
        : 'Optioneel bewaren uit. De huidige lijst blijft zolang de app open is.')
    } catch {
      setSessionProtected(true)
      setSessionEnabled(false)
      setSessionMessage('Browsertab-opslag geweigerd; gebruik een eigen JSON-backup.')
    }
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
      .map(source => {
        const row = source.replace(/^(?:[-*•]\s+|\d{1,3}[.)]\s+)/u, '')
        const done = /^(?:☑|\[[xX]\])(?:\s|$)/u.test(row)
        const label = safeLabel(row.replace(/^(?:☑|☐|\[[xX ]\])\s*/u, ''))
        return { label, done }
      })
      .filter(item => item.label.length > 0)
    if (!parsed.length || parsed.some(item => item.label.length > 140) || parsed.length > 100) {
      setMessage('Controleer de geplakte lijst: maximaal 100 regels van 140 tekens.')
      return
    }
    const seen = new Set(notes.map(item => duplicateKey(item.store, item.label)))
    const distinct = parsed.filter(item => {
      const key = duplicateKey(store, item.label)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (notes.length + distinct.length > 100) {
      setMessage('Je lijst heeft ruimte voor maximaal 100 verschillende artikelen. Er is niets toegevoegd.')
      return
    }
    const added = distinct.map(item => ({
      id: 'own-note-' + crypto.randomUUID(), label: item.label, store, done: item.done,
    }))
    setNotes(current => {
      const existing = new Set(current.map(item => duplicateKey(item.store, item.label)))
      const newItems = added.filter(item => !existing.has(duplicateKey(item.store, item.label)))
      return current.length + newItems.length > 100 ? current : [...current, ...newItems]
    })
    setBulkDraft('')
    setMessage(distinct.length + ' nieuwe artikelen toegevoegd aan ' + store +
      '; ' + (parsed.length - distinct.length) + ' dubbele regels overgeslagen. Zonder winkelprijzen.')
  }
  function add(event: FormEvent) {
    event.preventDefault()
    const label = safeLabel(name)
    if (!label || label.length > 140 || notes.length >= 100) {
      setMessage('Vul een geldige omschrijving in (max. 140 tekens en 100 artikelen).')
      return
    }
    if (notes.some(item => duplicateKey(item.store, item.label) === duplicateKey(store, label))) {
      setMessage('Dit artikel staat al bij ' + store + '; de bestaande afvinking blijft behouden.')
      return
    }
    setNotes(current => current.length >= 100 ||
      current.some(item => duplicateKey(item.store, item.label) === duplicateKey(store, label))
      ? current : [...current, { id: `own-note-${crypto.randomUUID()}`, label, store, done: false }])
    setName('')
    setMessage(`${label} toegevoegd zonder prijs. Dit verandert de supermarktvergelijking niet.`)
  }
  function saveEditedNote(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    const label = safeLabel(editing.label)
    const initial = notes.find(item => item.id === editing.id)
    if (!label || label.length > 140) {
      setMessage('Voer een geldige boodschap in van maximaal 140 tekens.')
      return
    }
    if (!initial || initial.label !== editing.initialLabel ||
        initial.store !== editing.initialStore) {
      setEditing(null)
      setMessage('Deze boodschap is intussen gewijzigd. Open de actuele regel opnieuw.')
      return
    }
    if (notes.some(item => item.id !== editing.id &&
        duplicateKey(item.store, item.label) === duplicateKey(editing.store, label))) {
      setMessage('Dit artikel staat al bij deze winkel. Er is niets overschreven.')
      return
    }
    setNotes(current => {
      const row = current.find(item => item.id === editing.id)
      if (!row || row.label !== editing.initialLabel ||
          row.store !== editing.initialStore ||
          current.some(item => item.id !== editing.id &&
            duplicateKey(item.store, item.label) === duplicateKey(editing.store, label))) return current
      return current.map(item => item.id === editing.id
        ? { ...item, label, store: editing.store } : item)
    })
    setEditing(null)
    setMessage('Je eigen boodschap is aangepast. De bestaande afvinking blijft behouden; er zijn geen prijzen toegevoegd.')
  }
  function removeOwnNote(id: string) {
    const index = notes.findIndex(note => note.id === id)
    if (index < 0) return
    setLastRemoved({ note: notes[index], index })
    setNotes(current => current.filter(note => note.id !== id))
    setMessage('Boodschap verwijderd. Je kunt de laatste verwijdering herstellen.')
  }
  function undoRemove() {
    if (!lastRemoved) return
    if (notes.length >= 100 || notes.some(note => note.id === lastRemoved.note.id)) {
      setMessage('Herstellen kan niet: de lijst is vol of dit artikel bestaat inmiddels opnieuw.')
      return
    }
    const { note, index } = lastRemoved
    setNotes(current => {
      if (current.length >= 100 || current.some(entry => entry.id === note.id)) return current
      const next = [...current]
      next.splice(Math.min(index, next.length), 0, note)
      return next
    })
    setLastRemoved(null)
    setMessage('De laatste eigen boodschap is met zijn oorspronkelijke vinkje hersteld.')
  }
  const selected = notes.filter(note => filterStore === 'Alle winkels' ||
    note.store === filterStore || note.store === 'Algemeen')
  const visible = onlyOpen ? selected.filter(note => !note.done) : selected
  const exportText = [
    'SUPA · EIGEN ONGEPRIJSDE BOODSCHAPPEN · ' + filterStore,
    'Los van Planner, bronopnames, weekbudget en winkelmandtotalen.', '',
    ...(onlyOpen ? ['Alleen nog open artikelen:'] : []),
    ...visible.map(note => (note.done ? '☑ ' : '☐ ') + `[${note.store}] ${safeLabel(note.label)} · prijs onbekend`),
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
    <p>Ook zonder prijsbestanden boodschappen toevoegen. Standaard tijdelijk; alleen met
      jouw toestemming blijven de vinkjes en artikelen na verversen in deze browsertab.
      Nooit meegenomen in weekbudget, twee winkelmanden of prijsverschil.</p>
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
        <p>Eén eigen artikel per regel. Opsommingstekens en originele vinkjes
          (☐, ☑, [ ] of [x]) worden herkend; al afgevinkte artikelen blijven afgevinkt.
          Alle regels gaan naar {store}; dubbele artikelen worden overgeslagen,
          zonder bestaande vinkjes of prijzen te wijzigen.</p>
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
      {editing?.id === note.id ? <form className="manual-shopping-notes__edit" onSubmit={saveEditedNote}>
        <label>Omschrijving
          <input maxLength={140} value={editing.label} autoFocus
            onChange={event => {
              const value = event.currentTarget.value
              setEditing(current => current?.id === note.id ? { ...current, label: value } : current)
            }} />
        </label>
        <label>Winkel
          <select value={editing.store} onChange={event => {
            const value = event.currentTarget.value as UnpricedShoppingNote['store']
            setEditing(current => current?.id === note.id ? { ...current, store: value } : current)
          }}>
            {stores.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="submit">Bewaar</button>
        <button type="button" onClick={() => setEditing(null)}>Annuleer</button>
        <small>Het vinkje en privé-ID blijven behouden; nooit automatisch een prijs.</small>
      </form> : <>
        <label><input type="checkbox" checked={note.done}
          onChange={() => setNotes(current => current.map(item => item.id === note.id
            ? { ...item, done: !item.done } : item))} />
          <span>{note.label} <small>· {note.store} · prijs onbekend</small></span></label>
        <button type="button" onClick={() => setEditing({ id: note.id,
          initialLabel: note.label, initialStore: note.store, label: note.label, store: note.store })}
          aria-label={`Bewerk ${note.label}`}>Bewerk</button>
        <button type="button" onClick={() => removeOwnNote(note.id)}
          aria-label={`Verwijder ${note.label}`}>Verwijder</button>
      </>}
    </li>)}</ul>
    {!visible.length && <p role="status">
      {selected.length ? 'Alle boodschappen in deze selectie zijn afgevinkt.' :
        'Nog geen boodschappen in deze selectie. De lijst werkt zonder winkelprijzen.'}
    </p>}
    {lastRemoved && <button type="button" className="ghost-button" onClick={undoRemove}>
      Herstel laatste verwijderde boodschap: {lastRemoved.note.label}
    </button>}
    <section className="manual-shopping-notes__session" aria-label="Optioneel bewaren in dit tabblad">
      <label><input type="checkbox" checked={sessionEnabled} disabled={sessionProtected}
        onChange={event => changeSessionOptIn(event.target.checked)} />
        Bewaar mijn eigen ongeprijsde lijst tijdelijk in deze browsertab</label>
      <small>Niet automatisch ingeschakeld. Geen cloud, geen winkelprijzen; stoppen wist
        alleen deze optionele sessiekopie, niet je geopende lijst of JSON-backup.</small>
      {sessionMessage && <p role="status" aria-live="polite">{sessionMessage}</p>}
    </section>
    <div className="manual-shopping-notes__actions">
      <button type="button" disabled={!visible.length} onClick={() => setExportVisible(value => !value)}>
        {exportVisible ? 'Verberg kopieertekst' : 'Toon kopieertekst'}</button>
      <button type="button" disabled={!visible.length} onClick={download}>Download lijst (TXT)</button>
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
    {exportVisible && visible.length > 0 && <label>Kopieer mijn ongeprijsde boodschappen
      <textarea rows={Math.min(selected.length + 6, 15)} readOnly value={exportText}
        onFocus={event => event.currentTarget.select()} /></label>}
    <p role="status" aria-live="polite">{message}</p>
  </section>
}
