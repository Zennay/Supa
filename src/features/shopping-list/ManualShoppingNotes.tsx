import { useState, type FormEvent, type Dispatch, type SetStateAction } from 'react'
import './manualShoppingNotes.css'

export type UnpricedShoppingNote = { id: string; label: string; store: 'Algemeen' | 'PLUS' | 'DekaMarkt'; done: boolean }
type SetNotes = Dispatch<SetStateAction<UnpricedShoppingNote[]>>
const stores = ['Algemeen', 'PLUS', 'DekaMarkt'] as const
const safeLabel = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/g, ' ').trim()

/** Private volatile notes; no product match, price or retailer-source authority. */
export function ManualShoppingNotes({ notes, setNotes }: { notes: UnpricedShoppingNote[]; setNotes: SetNotes }) {
  const [name, setName] = useState('')
  const [store, setStore] = useState<UnpricedShoppingNote['store']>('Algemeen')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [exportVisible, setExportVisible] = useState(false)
  const [message, setMessage] = useState('')
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
  const visible = onlyOpen ? notes.filter(note => !note.done) : notes
  const exportText = [
    'SUPA · EIGEN ONGEPRIJSDE BOODSCHAPPEN',
    'Los van Planner, bronopnames, weekbudget en winkelmandtotalen.', '',
    ...notes.map(note => (note.done ? '☑ ' : '☐ ') + `[${note.store}] ${safeLabel(note.label)} · prijs onbekend`),
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
    <div className="manual-shopping-notes__top">
      <strong>{notes.length} eigen {notes.length === 1 ? 'artikel' : 'artikelen'} · {notes.filter(n => n.done).length} afgevinkt</strong>
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
    {notes.length === 0 && <p role="status">Nog geen losse boodschappen. Deze lijst werkt zonder winkelprijzen.</p>}
    <div className="manual-shopping-notes__actions">
      <button type="button" disabled={!notes.length} onClick={() => setExportVisible(value => !value)}>
        {exportVisible ? 'Verberg kopieertekst' : 'Toon kopieertekst'}</button>
      <button type="button" disabled={!notes.length} onClick={download}>Download lijst (TXT)</button>
    </div>
    {exportVisible && <label>Kopieer mijn ongeprijsde boodschappen
      <textarea rows={Math.min(notes.length + 6, 15)} readOnly value={exportText}
        onFocus={event => event.currentTarget.select()} /></label>}
    <p role="status" aria-live="polite">{message}</p>
  </section>
}
