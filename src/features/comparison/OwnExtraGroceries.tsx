import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { decodeSaved, findReusableExtraLists, legacyKey, restore, storageKey, signalSavedExtras, valid, type Item, type ReusableExtraList, type Unit } from './ownExtraGroceriesStorage.ts'
import { CompleteWeekBackupControls } from './CompleteWeekBackupControls.tsx'
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
  const [openOnly, setOpenOnly] = useState(false)
  const [reuse, setReuse] = useState<ReusableExtraList[]>([])
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
    setReuse([])
    setNotice('')
  }, [identity])
  async function openPasteFile(file?: File) {
    if (!file) return
    try {
      if (!file.size || file.size > 20000) throw Error('Selecteer een tekstbestand van maximaal 20 kB.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (new TextEncoder().encode(text).length > 20000) throw Error('Tekstbestand te groot.')
      setPaste(text)
      setPendingPaste(null)
      setNotice('Tekst ingelezen. Controleer de regels via Bekijk plaklijst voordat je iets toevoegt.')
    } catch { setNotice('Kon bestand niet lezen. Gebruik een geldig UTF-8 TXT/MD-bestand (maximaal 20 kB).') }
  }
  function removeCompleted() {
    if (!items.some(item => item.done)) return
    if (!window.confirm('Alle afgevinkte extra boodschappen verwijderen? De Planner en winkelprijzen blijven intact.')) return
    setData(prev => ({ ...prev, items: items.filter(item => !item.done) }))
    setNotice('Afgevinkte extra artikelen verwijderd. Bewaar de gewijzigde lijst desgewenst in deze tab.')
  }
  function reuseOlderExtras(source: ReusableExtraList) {
    if (data.locked || currentIdentity.current !== identity) return
    // A prior week's tick is not a tick in the new physical shopping list.
    // Respect current manual additions; skip exact repeats rather than
    // creating multiple identical grocery rows in the new week.
    const same = (a: Item, b: Item) => a.name.toLocaleLowerCase('nl') ===
      b.name.toLocaleLowerCase('nl') && a.quantity === b.quantity && a.unit === b.unit
    const additions = source.items.filter(item => !items.some(existing => same(existing, item)))
    if (!additions.length) { setNotice('Deze boodschappen staan al in je huidige lijst.'); return }
    if (items.length + additions.length > 100) {
      setNotice('Deze oude lijst past niet volledig: maximaal 100 extra artikelen per week.')
      return
    }
    if (!window.confirm(additions.length + ' eerdere boodschappen ZONDER vinkjes of prijzen aan dit weekmenu toevoegen? Bestaande regels blijven staan.')) return
    if (currentIdentity.current !== identity) return
    const random = new Uint32Array(additions.length * 4)
    try { window.crypto.getRandomValues(random) } catch {
      setNotice('De browser ondersteunt geen veilige nieuwe artikel-ID’s.')
      return
    }
    const copied = additions.map((item, index) => ({ ...item, done: false,
      id: Array.from(random.slice(index * 4, index * 4 + 4),
        value => value.toString(16).padStart(8, '0')).join('-'),
    }))
    if (new Set([...items, ...copied].map(item => item.id)).size !== items.length + copied.length) {
      setNotice('Kon unieke artikel-ID’s niet veilig toekennen.')
      return
    }
    setData(prev => ({ ...prev, items: [...items, ...copied] }))
    setReuse([])
    setNotice(copied.length + ' terugkerende boodschappen toegevoegd, niet afgevinkt en zonder winkelprijs. Bewaar ze desgewenst in deze tab.')
  }
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
      // Common personal notes can be Markdown checklists or plain bullets.
      // Preserve a user-explicit [x] only in THIS new private list; importing
      // a different Planner week separately always resets its old checkmarks.
      const checkbox = /^(?:[-*•]\s*)?\[([ xX])\]\s+(.+)$/u.exec(line)
      const cleaned = checkbox ? checkbox[2].trim() :
        line.replace(/^[-*•]\s+/, '').trim()
      const done = checkbox?.[1].toLowerCase() === 'x'
      const parts = cleaned.split(';').map(s => s.trim())
      let name = cleaned
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
      const next: Item = { id: 'preview', name, quantity, unit, done }
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
      const scopedKey = storageKey(identity)
      if (sessionStorage.getItem(scopedKey) !== data.raw) throw Error('De bewaarde lijst is gewijzigd.')
      const raw = JSON.stringify({ schema: 'supa-extra-v1', identity, items })
      if (new TextEncoder().encode(raw).length > 100000) throw Error('Lijst te groot.')
      sessionStorage.setItem(scopedKey, raw)
      signalSavedExtras(identity)
      // Retire only the exact legacy record for THIS week after successful
      // scoped write. Never erase another week or an unknown legacy schema.
      const old = sessionStorage.getItem(legacyKey)
      if (old !== null) {
        try { decodeSaved(old, identity); if (sessionStorage.getItem(legacyKey) === old) sessionStorage.removeItem(legacyKey) }
        catch { /* Preserve unrelated or corrupt original data. */ }
      }
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
  async function downloadCompleteWeekPrint() {
    if (!items.length && !activeDays.length) return
    const sourceIdentity = identity
    const extraSnapshot = JSON.stringify(items)
    try {
      const { renderOwnCompleteWeekPrintableHtml } = await import('./ownCompleteWeekPrintableHtml.ts')
      const html = renderOwnCompleteWeekPrintableHtml(plan, recipes, activeDays,
        items, await readPlannerTicks())
      if (currentIdentity.current !== sourceIdentity ||
          JSON.stringify(items) !== extraSnapshot) {
        setNotice('De weeklijst is veranderd tijdens voorbereiden. Probeer opnieuw.')
        return
      }
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-volledige-weekboodschappen-afdruk.html'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setNotice('Offline afdrukbare HTML opgeslagen, met onbekende winkelprijzen en huidige vinkjes.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Kon de afdrukbare weeklijst niet maken.')
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
      <label>Plak boodschappen · naam per regel, artikel; hoeveelheid; stuks/g/ml of Markdown - [x]
        <textarea value={paste} maxLength={20000} rows={5}
          placeholder={'- [ ] Koffie; 500; g\n- [x] Toiletpapier; 6; stuks\n* Afwasmiddel'}
          onChange={event => { setPaste(event.target.value); setPendingPaste(null) }} />
      </label>
      <label className="unpriced-planner-checklist__upload">Of lees een lokaal tekstbestand (.txt / .md)
        <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void openPasteFile(file)
        }} />
      </label>
      <button type="submit" disabled={!paste.trim() || data.locked}>Bekijk plaklijst</button>
    </form>
    {pendingPaste && <div className="unpriced-planner-checklist__paste-preview">
      <h4>Controleer {pendingPaste.length} extra boodschappen zonder winkelprijzen</h4>
      <ul>{pendingPaste.map((row, index) => <li key={index}>
        {row.done ? '☑' : '☐'} {row.quantity} {row.unit === 'piece' ? 'stuks' : row.unit} {row.name}
      </li>)}</ul>
      <button type="button" onClick={acceptPaste}>Voeg alle artikelen toe</button>
      <button type="button" onClick={() => setPendingPaste(null)}>Annuleer</button>
    </div>}
    <div className="unpriced-planner-checklist__actions">
      <button type="button" disabled={data.locked} onClick={() => {
        const candidates = findReusableExtraLists(identity)
        setReuse(candidates)
        setNotice(candidates.length ? 'Kies bewust welke eerdere privéboodschappen je opnieuw wilt gebruiken.' :
          'Geen andere bewaarde weeklijsten gevonden in dit browsertabblad.')
      }}>Gebruik extra boodschappen uit een eerdere week</button>
    </div>
    {reuse.length > 0 && <section className="unpriced-planner-checklist__paste-preview"
      aria-label="Eerdere privéboodschappen voor dit weekmenu">
      <h4>Eerdere opgeslagen lijsten · geen vinkjes of winkelprijzen overnemen</h4>
      {reuse.map((source, index) => <details key={source.identity}>
        <summary>Privélijst {index + 1}: {source.label}</summary>
        <ul>{source.items.map(item => <li key={item.id}>{item.quantity} {item.unit === 'piece' ? 'stuks' : item.unit} {item.name}</li>)}</ul>
        <button type="button" onClick={() => reuseOlderExtras(source)}>Voeg nog ontbrekende artikelen toe</button>
      </details>)}
    </section>}
    <p>{items.filter(x => x.done).length} van {items.length} extra artikelen afgevinkt.</p>
    <div className="unpriced-planner-checklist__actions">
      <label><input type="checkbox" checked={openOnly}
        onChange={event => setOpenOnly(event.target.checked)} /> Alleen nog te kopen extra boodschappen</label>
      <button type="button" disabled={!items.some(item => item.done)}
        onClick={removeCompleted}>Verwijder afgevinkte extra artikelen</button>
    </div>
    <ul>{items.filter(item => !openOnly || !item.done).map(item => <li key={item.id}>
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
      <button type="button" onClick={() => void downloadCompleteWeekPrint()}>
        Download afdrukbare complete weeklijst (HTML)
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
          if (sessionStorage.getItem(storageKey(identity)) !== data.raw) throw Error('changed')
          sessionStorage.removeItem(storageKey(identity))
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
    {data.locked && <p role="alert">De opgeslagen extra lijst voor deze week is niet leesbaar of is gewijzigd.
      Het bewaarde bestand wordt niet overschreven.</p>}
    <CompleteWeekBackupControls identity={identity} plan={plan} recipes={recipes}
      activeDays={activeDays} extras={items} currentRaw={data.raw}
      locked={data.locked} onRestore={(restored, savedRaw) => {
        setData(prev => ({ ...prev, identity, raw: savedRaw, items: restored }))
        setEditing(null)
        setPreparedCopy(null)
      }} />
    {notice && <p role="status">{notice}</p>}
  </section>
}
