import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
type Unit = 'g' | 'ml' | 'piece'
type Item = { id: string; name: string; quantity: number; unit: Unit; done: boolean }
const key = 'supa:extra-groceries-tab:v1'
const valid = (x: Item) => /^[\w-]{1,100}$/.test(x.id) &&
  typeof x.name === 'string' && x.name.length > 0 && x.name.length <= 120 &&
  x.name === x.name.trim() && /[\p{L}\p{N}]/u.test(x.name) &&
  !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x.name) &&
  Number.isFinite(x.quantity) && x.quantity > 0 && x.quantity <= 100000 &&
  ['g','ml','piece'].includes(x.unit) && (x.unit !== 'piece' || Number.isSafeInteger(x.quantity)) &&
  typeof x.done === 'boolean'
function decodeSaved(raw: string, identity: string) {
  if (new TextEncoder().encode(raw).length > 100000) throw Error('size')
  const v: unknown = JSON.parse(raw)
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('shape')
  const record = v as Record<string, unknown>
  if (record.schema !== 'supa-extra-v1' || typeof record.identity !== 'string' ||
      !Array.isArray(record.items) || record.items.length > 100 ||
      Object.keys(record).some(k => !['schema', 'identity', 'items'].includes(k)) ||
      !record.items.every((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false
        const row = item as Record<string, unknown>
        return Object.keys(row).length === 5 &&
          Object.keys(row).every(k => ['id', 'name', 'quantity', 'unit', 'done'].includes(k)) &&
          typeof row.id === 'string' && valid(row as Item)
      }) ||
      new Set(record.items.map((item: Item) => item.id)).size !== record.items.length)
    throw Error('shape')
  if (record.identity !== identity) throw Error('other-week')
  return record.items as Item[]
}
function restore(identity: string) {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(key)
    if (!raw) return { items: [] as Item[], raw, locked: false }
    return { items: decodeSaved(raw, identity), raw, locked: false }
  } catch { return { items: [] as Item[], raw, locked: true } }
}
export function OwnExtraGroceries({ identity, plan, recipes, activeDays }: {
  identity: string
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}) {
  const [data, setData] = useState(() => ({ identity, ...restore(identity) }))
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<Unit>('piece')
  const [notice, setNotice] = useState('')
  const [paste, setPaste] = useState('')
  const [pendingPaste, setPendingPaste] = useState<Item[] | null>(null)
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  const [preparedCopy, setPreparedCopy] = useState<{
    identity: string
    extras: string
    text: string
  } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editQuantity, setEditQuantity] = useState('1')
  const [editUnit, setEditUnit] = useState<Unit>('piece')
  const items = data.identity === identity ? data.items : []
  useEffect(() => {
    setData({ identity, ...restore(identity) })
    setEditing(null)
    setPendingPaste(null)
    setPaste('')
    setNotice('')
  }, [identity])
  function previewPaste(event: FormEvent) {
    event.preventDefault()
    setPendingPaste(null)
    if (new TextEncoder().encode(paste).length > 20000) {
      setNotice('Plak maximaal 20 kB aan boodschappen.')
      return
    }
    const lines = paste.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean)
    if (!lines.length || lines.length > 100 || items.length + lines.length > 100) {
      setNotice('Plak minimaal één artikel, maximaal 100 inclusief je bestaande extra boodschappen.')
      return
    }
    const preview: Item[] = []
    for (const line of lines) {
      const parts = line.split(';').map(s => s.trim())
      let name = line
      let quantity = 1
      let unit: Unit = 'piece'
      if (parts.length === 3) {
        const [, amount, kind] = parts
        if (!/^\d{1,6}(?:[.,]\d{1,3})?$/.test(amount)) {
          setNotice('Ongeldige hoeveelheid: gebruik bijvoorbeeld koffie; 2; stuks.')
          return
        }
        name = parts[0]
        quantity = Number(amount.replace(',', '.'))
        if (!['stuks', 'g', 'ml'].includes(kind.toLowerCase())) {
          setNotice('Gebruik uitsluitend stuks, g of ml bij geplakte hoeveelheden.')
          return
        }
        unit = kind.toLowerCase() === 'stuks' ? 'piece' : kind.toLowerCase() as Unit
      } else if (parts.length !== 1) {
        setNotice('Gebruik één artikel per regel of artikel; hoeveelheid; stuks/g/ml.')
        return
      }
      const next: Item = { id: 'preview', name, quantity, unit, done: false }
      if (!valid(next)) {
        setNotice('Een van de regels bevat een ongeldig artikel of een ongeldige hoeveelheid.')
        return
      }
      preview.push(next)
    }
    setPendingPaste(preview)
    setNotice('Controleer de voorbeeldregels voordat je ze toevoegt. Er zijn nog geen artikelen gewijzigd.')
  }
  function acceptPaste() {
    if (!pendingPaste || items.length + pendingPaste.length > 100 || data.locked) return
    const values = new Uint32Array(pendingPaste.length * 4)
    try { window.crypto.getRandomValues(values) } catch {
      setNotice('Deze browser kan geen veilige artikel-ID maken.')
      return
    }
    const imported = pendingPaste.map((item, index) => ({ ...item,
      id: Array.from(values.slice(index * 4, index * 4 + 4), n =>
        n.toString(16).padStart(8, '0')).join('-'),
    }))
    if (new Set([...items, ...imported].map(item => item.id)).size !== items.length + imported.length) {
      setNotice('Unieke artikel-ID kon niet worden toegekend. Probeer opnieuw.')
      return
    }
    setData(prev => ({ ...prev, identity, items: [...items, ...imported] }))
    setPendingPaste(null)
    setPaste('')
    setNotice(`${imported.length} ongeprijsde boodschappen toegevoegd. Bewaar ze desgewenst in deze tab.`)
  }
  function add(e: FormEvent) {
    e.preventDefault()
    // crypto.randomUUID() is secure-context-only. Supa's private IP/HTTP
    // deployment still gets cryptographically random local IDs.
    const random = new Uint32Array(4)
    try { window.crypto.getRandomValues(random) } catch {
      setNotice('Deze browser kan geen veilige artikel-ID maken. Gebruik een actuele browser.')
      return
    }
    const id = Array.from(random, part => part.toString(16).padStart(8, '0')).join('-')
    const item: Item = { id, name: name.trim(),
      quantity: Number(quantity.replace(',', '.')), unit, done: false }
    if (!valid(item) || items.some(existing => existing.id === id) ||
        !/^\d{1,6}(?:[.,]\d{1,3})?$/.test(quantity) || items.length >= 100) {
      setNotice('Gebruik een naam en geldige hoeveelheid; fysieke stuks moeten heel zijn.')
      return
    }
    setData(prev => ({ ...prev, identity, items: [...items, item] }))
    setName(''); setQuantity('1')
    setNotice('Extra toegevoegd, zonder prijs en buiten de vergelijking.')
  }
  function edit(item: Item) {
    setEditing(item.id)
    setEditName(item.name)
    setEditQuantity(String(item.quantity))
    setEditUnit(item.unit)
    setNotice('')
  }
  function saveEdit(event: FormEvent) {
    event.preventDefault()
    const existing = items.find(item => item.id === editing)
    if (!existing) {
      setEditing(null)
      setNotice('Het artikel is inmiddels verwijderd; wijziging niet opgeslagen.')
      return
    }
    const updated: Item = { ...existing, name: editName.trim(),
      quantity: Number(editQuantity.replace(',', '.')), unit: editUnit }
    if (!valid(updated) || !/^\d{1,6}(?:[.,]\d{1,3})?$/.test(editQuantity)) {
      setNotice('Controleer artikelnaam en hoeveelheid; stuks moeten hele aantallen zijn.')
      return
    }
    setData(prev => ({ ...prev,
      items: items.map(item => item.id === existing.id ? updated : item) }))
    setEditing(null)
    setNotice('Extra artikel bijgewerkt; gebruik Bewaar in deze tab om het lokaal te bewaren.')
  }
  function persist() {
    if (data.locked) return
    try {
      if (sessionStorage.getItem(key) !== data.raw) throw Error('De bewaarde lijst is gewijzigd.')
      const raw = JSON.stringify({ schema: 'supa-extra-v1', identity, items })
      if (new TextEncoder().encode(raw).length > 100000) throw Error('Lijst te groot.')
      sessionStorage.setItem(key, raw)
      setData(prev => ({ ...prev, raw }))
      setNotice('Extra lijst uitsluitend in dit browsertabblad bewaard.')
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Bewaren mislukt.') }
  }
  async function readPlannerTicks(): Promise<Record<string, boolean> | null> {
    if (!activeDays.length) return {}
    const [{ aggregatePlanIngredients }, progress] = await Promise.all([
      import('../../domain/basket.ts'),
      import('./unpricedPlannerProgress.ts'),
    ])
    const demand = aggregatePlanIngredients(plan, recipes, activeDays)
    const keys = demand.map(item => JSON.stringify([item.id, item.label, item.amount, item.unit]))
    const demandIdentity = JSON.stringify([activeDays, keys])
    try {
      const raw = window.sessionStorage.getItem(progress.unpricedProgressStorageKey(demandIdentity))
      return raw ? progress.importUnpricedProgress(raw, demandIdentity, keys) : {}
    } catch {
      // Never invent completion when an old/private tab snapshot cannot be read.
      return null
    }
  }
  async function prepareCompleteListCopy() {
    const originalIdentity = identity
    const extras = JSON.stringify(items)
    try {
      const { ownCompleteWeekText } = await import('./ownCompleteWeekCsv.ts')
      const text = ownCompleteWeekText(plan, recipes, activeDays, items,
        await readPlannerTicks())
      if (currentIdentity.current !== originalIdentity) return
      setPreparedCopy({ identity: originalIdentity, extras, text })
      setNotice('Selecteer de complete weeklijst hieronder om te kopiëren, bijvoorbeeld op je telefoon.')
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Weeklijst kan niet worden gekopieerd.')
    }
  }
  async function downloadCompleteWeek() {
    if (!items.length && !activeDays.length) return
    const originalIdentity = identity
    try {
      const { exportOwnCompleteWeekCsv } = await import('./ownCompleteWeekCsv.ts')
      const csv = exportOwnCompleteWeekCsv(plan, recipes, activeDays, items,
        await readPlannerTicks())
      if (currentIdentity.current !== originalIdentity) {
        setNotice('Planner is veranderd tijdens downloaden. Probeer opnieuw.')
        return
      }
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv],
        { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-volledige-weekboodschappen-zonder-prijzen.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setNotice('Volledig fysiek weekmandje gedownload: Planner plus eigen extras, alle prijzen onbekend.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Kon het complete weekmandje niet exporteren.')
    }
  }
  function downloadBackup() {
    if (!items.length) return
    try {
      const raw = JSON.stringify({ schema: 'supa-extra-v1', identity, items })
      if (new TextEncoder().encode(raw).length > 100000) throw Error('Back-up is te groot.')
      const url = URL.createObjectURL(new Blob([raw],
        { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-extra-boodschappen-prive.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setNotice('Privé-back-up van extra artikelen gedownload; zonder winkelprijzen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Back-up kon niet worden gedownload.')
    }
  }
  async function importBackup(file?: File) {
    if (!file) return
    const expectedIdentity = identity
    try {
      if (!file.size || file.size > 100000) throw Error('Kies een JSON-back-up van maximaal 100 kB.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (currentIdentity.current !== expectedIdentity) throw Error('Weekmenu is veranderd tijdens import.')
      const restored = decodeSaved(raw, expectedIdentity)
      if (!window.confirm('Vervang de huidige extra boodschappen door deze privé-back-up voor exact hetzelfde weekmenu?')) return
      if (currentIdentity.current !== expectedIdentity) throw Error('Weekmenu is gewijzigd. Niets hersteld.')
      setData(prev => ({ ...prev, identity: expectedIdentity, items: restored }))
      setEditing(null)
      setNotice('Extra boodschappen uit back-up ingelezen. Klik Bewaar in deze tab om ze lokaal te bewaren.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Ongeldige privé-back-up; huidige lijst blijft behouden.')
    }
  }
  async function downloadCsv() {
    if (!items.length) return
    try {
      const { exportOwnExtraGroceriesCsv } = await import('./ownExtraGroceriesCsv.ts')
      const csv = exportOwnExtraGroceriesCsv(items)
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv],
        { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-extra-boodschappen-zonder-prijzen.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setNotice('Alle extra artikelen lokaal als CSV opgeslagen, zonder winkelprijzen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'CSV kon niet worden opgeslagen.')
    }
  }
  return <section id="supa-own-extra-groceries" className="unpriced-planner-checklist__extras"
    aria-label="Eigen extra ongeprijsde boodschappen">
    <h3>Eigen extra boodschappen</h3>
    <p>Artikelen naast recepten, zoals koffie of toiletpapier. Deze zijn ongeprijsd en
      tellen niet mee in PLUS/Deka-mandjes of besparingsclaims.</p>
    <form onSubmit={add} className="unpriced-planner-checklist__actions">
      <label>Artikel <input required maxLength={120} value={name}
        onChange={e => setName(e.target.value)} /></label>
      <label>Hoeveelheid <input required inputMode="decimal" value={quantity}
        onChange={e => setQuantity(e.target.value)} /></label>
      <label>Eenheid <select value={unit} onChange={e => setUnit(e.target.value as Unit)}>
        <option value="piece">stuks</option><option value="g">gram</option><option value="ml">ml</option>
      </select></label>
      <button type="submit">Voeg toe</button>
    </form>
    <form onSubmit={previewPaste} className="unpriced-planner-checklist__paste">
      <label>Plak eigen boodschappen · één artikel per regel, of artikel; hoeveelheid; stuks/g/ml
        <textarea value={paste} maxLength={20000} rows={5}
          placeholder={'Koffie; 500; g\nToiletpapier; 6; stuks\nAfwasmiddel'}
          onChange={event => { setPaste(event.target.value); setPendingPaste(null) }} />
      </label>
      <button type="submit" disabled={!paste.trim() || data.locked}>Bekijk plaklijst</button>
    </form>
    {pendingPaste && <div className="unpriced-planner-checklist__paste-preview">
      <h4>Controleer {pendingPaste.length} extra boodschappen zonder winkelprijzen</h4>
      <ul>{pendingPaste.map((row, index) => <li key={index}>
        {row.quantity} {row.unit === 'piece' ? 'stuks' : row.unit} {row.name}
      </li>)}</ul>
      <button type="button" onClick={acceptPaste}>Voeg alle artikelen toe</button>
      <button type="button" onClick={() => setPendingPaste(null)}>Annuleer</button>
    </div>}
    <p>{items.filter(x => x.done).length} van {items.length} extra artikelen afgevinkt.</p>
    <ul>{items.map(item => <li key={item.id}>
      {editing === item.id ? <form onSubmit={saveEdit} className="unpriced-planner-checklist__actions">
        <label>Artikel <input required maxLength={120} value={editName}
          onChange={e => setEditName(e.target.value)} /></label>
        <label>Hoeveelheid <input required inputMode="decimal" value={editQuantity}
          onChange={e => setEditQuantity(e.target.value)} /></label>
        <label>Eenheid <select value={editUnit} onChange={e => setEditUnit(e.target.value as Unit)}>
          <option value="piece">stuks</option><option value="g">gram</option><option value="ml">ml</option>
        </select></label>
        <button type="submit">Opslaan</button>
        <button type="button" onClick={() => setEditing(null)}>Annuleren</button>
      </form> : <>
        <label><input type="checkbox" checked={item.done} onChange={e => setData(prev => ({
          ...prev, items: items.map(x => x.id === item.id ? { ...x, done: e.target.checked } : x),
        }))} />{item.quantity} {item.unit === 'piece' ? 'stuks' : item.unit} {item.name}</label>
        <button type="button" onClick={() => edit(item)}>Bewerk</button>
        <button type="button" onClick={() => setData(prev => ({ ...prev,
          items: items.filter(x => x.id !== item.id) }))}>Verwijder</button>
      </>}
    </li>)}</ul>
    <div className="unpriced-planner-checklist__actions">
      <button type="button" onClick={() => void prepareCompleteListCopy()}>
        Toon complete weeklijst om te kopiëren
      </button>
      <button type="button" onClick={() => void downloadCompleteWeek()}>
        Download complete weeklijst · recepten + extra (CSV)
      </button>
      <button type="button" disabled={!items.length} onClick={downloadBackup}>
        Download privé-back-up (JSON)
      </button>
      <label className="unpriced-planner-checklist__upload">
        Herstel eigen extra boodschappen (JSON)
        <input type="file" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void importBackup(file)
        }} />
      </label>
      <button type="button" disabled={!items.length} onClick={() => void downloadCsv()}>
        Download extra boodschappen (CSV)
      </button>
      <button type="button" disabled={data.locked} onClick={persist}>Bewaar in deze tab</button>
      <button type="button" disabled={!data.raw} onClick={() => {
        if (!window.confirm('Verwijder alleen de bewaarde extra boodschappen uit dit tabblad?')) return
        try {
          if (sessionStorage.getItem(key) !== data.raw) throw Error('changed')
          sessionStorage.removeItem(key)
          setData(prev => ({ ...prev, raw: null, locked: false }))
          setNotice('Tabopslag gewist; items blijven tijdelijk in beeld.')
        } catch { setNotice('Bewaard record gewijzigd; niets verwijderd.') }
      }}>Wis bewaarde tablijst</button>
    </div>
    {preparedCopy?.identity === identity &&
      preparedCopy.extras === JSON.stringify(items) &&
      <div className="unpriced-planner-checklist__copy">
        <label>Complete ongeprijsde weeklijst · kopieerbare tekst
          <textarea readOnly rows={Math.min(20, preparedCopy.text.split('\n').length)}
            value={preparedCopy.text} onFocus={event => event.currentTarget.select()} />
        </label>
      </div>}
    {data.locked && <p role="alert">Bestaande extra lijst van een andere week of versie
      is beschermd tegen overschrijven. Je huidige extra items blijven tijdelijk beschikbaar.</p>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
