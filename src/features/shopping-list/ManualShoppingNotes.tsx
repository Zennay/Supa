import { useEffect, useRef, useState, type FormEvent, type Dispatch, type SetStateAction } from 'react'
import './manualShoppingNotes.css'
import { exportUnpricedShoppingCsv, exportUnpricedShoppingTsv, importUnpricedShoppingCsv, importUnpricedShoppingPaste } from './manualShoppingNotesCsv.ts'
import { mergePrivateNotes, normalizePrivateNotes, serializePrivateNotes, PRIVATE_NOTES_BACKUP_MAX_BYTES } from './manualShoppingNotesBackup.ts'
import { privateNoteDuplicateKey, privateNoteLabelIdentity } from './manualShoppingNoteIdentity.ts'
import { makePrivateShoppingTemplate, parsePrivateShoppingTemplate, PRIVATE_SHOPPING_TEMPLATE_KEY, PRIVATE_SHOPPING_TEMPLATE_MAX_BYTES, type PrivateShoppingTemplateItem } from './manualShoppingTemplate.ts'

export type UnpricedShoppingNote = { id: string; label: string; store: 'Algemeen' | 'PLUS' | 'DekaMarkt'; done: boolean }
type SetNotes = Dispatch<SetStateAction<UnpricedShoppingNote[]>>
const stores = ['Algemeen', 'PLUS', 'DekaMarkt'] as const
const privateSessionKey = 'supa:unpriced-notes:session:v1'
const privateDeviceKey = 'supa:unpriced-notes:device:v1'
const safeLabel = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/g, ' ').trim()
const duplicateKey = privateNoteDuplicateKey

/** Private volatile notes; no product match, price or retailer-source authority. */
export function ManualShoppingNotes({ notes, setNotes }: {
  notes: UnpricedShoppingNote[]
  setNotes: SetNotes
}) {
  const [name, setName] = useState('')
  const [bulkDraft, setBulkDraft] = useState('')
  const [ownCsvPaste, setOwnCsvPaste] = useState('')
  const [bulkPreview, setBulkPreview] = useState<{
    draft: string; existing: string; selectedStore: UnpricedShoppingNote['store'];
    incoming: Array<Pick<UnpricedShoppingNote, 'label' | 'store' | 'done'>>;
    duplicateCount: number
  } | null>(null)
  const bulkFileSerial = useRef(0)
  const [store, setStore] = useState<UnpricedShoppingNote['store']>('Algemeen')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [firstShop, setFirstShop] = useState<'PLUS' | 'DekaMarkt'>('PLUS')
  const [moveTargets, setMoveTargets] = useState<Record<UnpricedShoppingNote['store'], UnpricedShoppingNote['store']>>({
    Algemeen: 'PLUS', PLUS: 'DekaMarkt', DekaMarkt: 'PLUS',
  })
  const [filterStore, setFilterStore] = useState<'Alle winkels' | UnpricedShoppingNote['store']>('Alle winkels')
  // Ephemeral UI selection only. It never changes note IDs, prices or stored backup format.
  const [selectedMoveIds, setSelectedMoveIds] = useState<string[]>([])
  const [repeatName, setRepeatName] = useState('Mijn vaste boodschappen')
  const [repeatRaw, setRepeatRaw] = useState<string | null>(null)
  const [repeatProtected, setRepeatProtected] = useState(false)
  const [repeatMessage, setRepeatMessage] = useState('')
  const repeatFileSerial = useRef(0)
  const [repeatFilePreview, setRepeatFilePreview] = useState<{
    raw: string; name: string; items: PrivateShoppingTemplateItem[]; previous: string | null;
  } | null>(null)
  const [repeatPreview, setRepeatPreview] = useState<{
    name: string; raw: string; original: string;
    additions: PrivateShoppingTemplateItem[]; skipped: number;
    // Explicit subset of the original reviewed template. These are indices into
    // additions, not note IDs or retailer product identifiers.
    selectedIndices: number[];
  } | null>(null)
  const [exportVisible, setExportVisible] = useState(false)
  const [spreadsheetFallback, setSpreadsheetFallback] = useState('')
  const [message, setMessage] = useState('')
  const [lastRemoved, setLastRemoved] = useState<{ note: UnpricedShoppingNote; index: number } | null>(null)
  const [pendingDuplicateChoice, setPendingDuplicateChoice] = useState<{
    plus: UnpricedShoppingNote; deka: UnpricedShoppingNote; keep: 'PLUS' | 'DekaMarkt'
  } | null>(null)
  const [pendingDuplicateBatch, setPendingDuplicateBatch] = useState<{
    pairs: { plus: UnpricedShoppingNote; deka: UnpricedShoppingNote }[];
    keep: 'PLUS' | 'DekaMarkt'
  } | null>(null)
  const [lastDuplicateBatch, setLastDuplicateBatch] = useState<
    { note: UnpricedShoppingNote; index: number }[] | null>(null)
  const [pendingGeneralDuplicates, setPendingGeneralDuplicates] = useState<
    UnpricedShoppingNote[] | null>(null)
  const [lastGeneralDuplicates, setLastGeneralDuplicates] = useState<
    { note: UnpricedShoppingNote; index: number }[] | null>(null)
  const [pendingCleared, setPendingCleared] = useState<UnpricedShoppingNote[] | null>(null)
  const [pendingNextRound, setPendingNextRound] = useState<UnpricedShoppingNote[] | null>(null)
  const [lastNextRound, setLastNextRound] = useState<UnpricedShoppingNote[] | null>(null)
  const [lastGroupMove, setLastGroupMove] = useState<{
    from: UnpricedShoppingNote['store']; to: UnpricedShoppingNote['store'];
    items: Array<Pick<UnpricedShoppingNote, 'id' | 'label' | 'done'>>
  } | null>(null)
  const [lastCleared, setLastCleared] = useState<Array<{ note: UnpricedShoppingNote; index: number }> | null>(null)
  const [editing, setEditing] = useState<{ id: string; initialLabel: string;
    initialStore: UnpricedShoppingNote['store']; label: string;
    store: UnpricedShoppingNote['store'] } | null>(null)
  const [sessionEnabled, setSessionEnabled] = useState(false)
  const [sessionProtected, setSessionProtected] = useState(false)
  const [sessionRaw, setSessionRaw] = useState<string | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')
  const [deviceEnabled, setDeviceEnabled] = useState(false)
  const [deviceProtected, setDeviceProtected] = useState(false)
  const [deviceRaw, setDeviceRaw] = useState<string | null>(null)
  const [deviceMessage, setDeviceMessage] = useState('')
  // Never silently choose between two different private copies. A saved record
  // proves an earlier explicit opt-in, never permission to replace live notes.
  useEffect(() => {
    let tabRaw: string | null = null
    let persistentRaw: string | null = null
    try { tabRaw = window.sessionStorage.getItem(privateSessionKey) }
    catch {
      setSessionProtected(true)
      setSessionMessage('Tabopslag is niet beschikbaar. Je kunt een JSON-backup gebruiken.')
    }
    try { persistentRaw = window.localStorage.getItem(privateDeviceKey) }
    catch {
      setDeviceProtected(true)
      setDeviceMessage('Apparaatopslag is niet beschikbaar; er is niets opgeslagen.')
    }
    try {
      const sources = [tabRaw, persistentRaw].filter((raw): raw is string => raw !== null)
      if (!sources.length) return
      const normalized = sources.map(raw => {
        if (new TextEncoder().encode(raw).length > PRIVATE_NOTES_BACKUP_MAX_BYTES) throw Error('size')
        return serializePrivateNotes(normalizePrivateNotes(JSON.parse(raw)))
      })
      if (normalized.some(value => value !== normalized[0]) ||
          (notes.length > 0 && serializePrivateNotes(notes) !== normalized[0])) {
        throw Error('conflicting-private-copies')
      }
      const restored = normalizePrivateNotes(JSON.parse(sources[0]))
      if (notes.length === 0) setNotes(current => current.length ? current : restored)
      if (tabRaw !== null) {
        setSessionRaw(tabRaw); setSessionEnabled(true)
        setSessionMessage('De eerder bewaarde tablijst is veilig hersteld.')
      }
      if (persistentRaw !== null) {
        setDeviceRaw(persistentRaw); setDeviceEnabled(true)
        setDeviceMessage('Je bewust bewaarde apparaatlijst is hersteld, ook na het sluiten van de tab.')
      }
    } catch {
      setSessionProtected(true)
      setDeviceProtected(true)
      setSessionMessage('Twee privéversies verschillen of opslag is ongeldig: niets overschreven. Herstel via je JSON-backup.')
      setDeviceMessage('Opgeslagen privéversies blijven beschermd tot je ze handmatig controleert.')
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
  // Device persistence is separate from the tab: explicit opt-in only,
  // private browser storage, no retailer source data and no cloud writes.
  useEffect(() => {
    if (!deviceEnabled || deviceProtected) return
    try {
      const raw = window.localStorage.getItem(privateDeviceKey)
      if (raw !== deviceRaw) {
        setDeviceProtected(true)
        setDeviceEnabled(false)
        setDeviceMessage('Een ander tabblad heeft de apparaatlijst gewijzigd; deze versie wordt niet overschreven.')
        return
      }
      const next = serializePrivateNotes(notes)
      if (new TextEncoder().encode(next).length > PRIVATE_NOTES_BACKUP_MAX_BYTES) throw Error('size')
      if (raw !== next) window.localStorage.setItem(privateDeviceKey, next)
      if (deviceRaw !== next) setDeviceRaw(next)
    } catch {
      setDeviceEnabled(false)
      setDeviceProtected(true)
      setDeviceMessage('Bewaren op dit apparaat is gestopt. Exporteer je huidige lijst als JSON-backup.')
    }
  }, [deviceEnabled, deviceProtected, deviceRaw, notes])
  useEffect(() => {
    const onOtherTab = (event: StorageEvent) => {
      if (!deviceEnabled || deviceProtected || (event.key !== privateDeviceKey && event.key !== null)) return
      if (event.newValue !== deviceRaw) {
        setDeviceEnabled(false)
        setDeviceProtected(true)
        setDeviceMessage('Een andere tab heeft de opgeslagen boodschappen veranderd. Je huidige lijst blijft open; gebruik JSON voor veilig samenvoegen.')
      }
    }
    window.addEventListener('storage', onOtherTab)
    return () => window.removeEventListener('storage', onOtherTab)
  }, [deviceEnabled, deviceProtected, deviceRaw])
  function changeDeviceOptIn(checked: boolean) {
    if (deviceProtected) return
    try {
      const actual = window.localStorage.getItem(privateDeviceKey)
      if (actual !== deviceRaw) {
        setDeviceEnabled(false)
        setDeviceProtected(true)
        setDeviceMessage('Er bestaat een andere apparaatversie. Je huidige boodschappen worden niet overschreven.')
        return
      }
      if (!checked) {
        if (actual !== null) window.localStorage.removeItem(privateDeviceKey)
        setDeviceRaw(null)
      } else {
        const next = serializePrivateNotes(notes)
        if (new TextEncoder().encode(next).length > PRIVATE_NOTES_BACKUP_MAX_BYTES) throw Error('size')
        window.localStorage.setItem(privateDeviceKey, next)
        setDeviceRaw(next)
      }
      setDeviceEnabled(checked)
      setDeviceMessage(checked
        ? 'Boodschappen staan privé op dit apparaat en komen terug na sluiten van de tab. Geen server of prijsdata.'
        : 'Apparaatkopie gewist. De geopende lijst en eventuele JSON-backup blijven behouden.')
    } catch {
      setDeviceEnabled(false)
      setDeviceProtected(true)
      setDeviceMessage('Apparaatopslag is geweigerd. Je geopende lijst blijft onaangeroerd.')
    }
  }
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
  // A reusable personal template is saved only after a direct user action.
  // Device changes from other tabs are treated as conflicts, not overwrites.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY)
      if (raw !== null) {
        const template = parsePrivateShoppingTemplate(raw)
        setRepeatRaw(raw)
        setRepeatName(template.name)
        setRepeatMessage('Je eigen herhaalronde is beschikbaar, maar nog niet aan je lijst toegevoegd.')
      }
    } catch {
      setRepeatProtected(true)
      setRepeatMessage('Een bestaand sjabloon is ongeldig of opslag is geweigerd. Niets overschreven.')
    }
  }, [])
  useEffect(() => {
    const onChange = (event: StorageEvent) => {
      if (event.key !== PRIVATE_SHOPPING_TEMPLATE_KEY && event.key !== null) return
      if (event.newValue !== repeatRaw) {
        setRepeatProtected(true)
        setRepeatPreview(null)
        setRepeatMessage('Een andere tab heeft je herhaalronde veranderd. Deze versie blijft beschermd.')
      }
    }
    window.addEventListener('storage', onChange)
    return () => window.removeEventListener('storage', onChange)
  }, [repeatRaw])

  const [backupPreview, setBackupPreview] = useState<{
    incoming: UnpricedShoppingNote[]; existing: string;
    additions: UnpricedShoppingNote[]; duplicateCount: number;
  } | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [lastImport, setLastImport] = useState<{
    source: 'JSON-backup' | 'tekstlijst' | 'sjabloon'; added: UnpricedShoppingNote[]
  } | null>(null)
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
      setBackupPreview({
        incoming: parsed, existing: serializePrivateNotes(notes),
        additions: merged.notes.slice(notes.length),
        duplicateCount: parsed.length - merged.added,
      })
      setMessage(merged.added + ' nieuwe boodschappen gevonden. Controleer de winkellijsten en bevestig de import.')
    } catch (error) {
      if (version === readVersion.current) setMessage(error instanceof Error ? error.message : 'Kon backup niet inlezen.')
    } finally { if (version === readVersion.current) setBackupBusy(false) }
  }
  function previewSavedCopy(kind: 'tab' | 'device') {
    try {
      const raw = kind === 'device'
        ? window.localStorage.getItem(privateDeviceKey)
        : window.sessionStorage.getItem(privateSessionKey)
      if (!raw) throw Error('Geen opgeslagen kopie meer beschikbaar.')
      if (new TextEncoder().encode(raw).length > PRIVATE_NOTES_BACKUP_MAX_BYTES)
        throw Error('De bewaarde kopie is te groot. Gebruik je eigen JSON-backup.')
      const incoming = normalizePrivateNotes(JSON.parse(raw))
      const merged = mergePrivateNotes(notes, incoming)
      setBackupPreview({
        incoming, existing: serializePrivateNotes(notes),
        additions: merged.notes.slice(notes.length),
        duplicateCount: incoming.length - merged.added,
      })
      setMessage('Opgeslagen ' + (kind === 'device' ? 'apparaatkopie' : 'tabkopie') +
        ' is veilig ter controle geopend. Kies onderaan bewust voor samenvoegen, of annuleer.')
    } catch (error) {
      setBackupPreview(null)
      setMessage(error instanceof Error ? error.message : 'Opgeslagen privéversie kan niet worden bekeken.')
    }
  }
  function discardProtectedCopy(kind: 'tab' | 'device') {
    try {
      const storage = kind === 'device' ? window.localStorage : window.sessionStorage
      const key = kind === 'device' ? privateDeviceKey : privateSessionKey
      const before = storage.getItem(key)
      if (!window.confirm('Verwijder alleen deze opgeslagen ' +
        (kind === 'device' ? 'apparaatkopie' : 'tabkopie') +
        '? Dit kan niet ongedaan worden gemaakt. Download eerst een JSON-backup als je deze versie nodig hebt.')) return
      if (storage.getItem(key) !== before) {
        setMessage('De opgeslagen versie is intussen veranderd; verwijderen geweigerd.')
        return
      }
      storage.removeItem(key)
      if (kind === 'device') {
        setDeviceEnabled(false); setDeviceProtected(false); setDeviceRaw(null)
        setDeviceMessage('Oude apparaatkopie verwijderd. Bewaren kan weer vrijwillig worden aangezet.')
      } else {
        setSessionEnabled(false); setSessionProtected(false); setSessionRaw(null)
        setSessionMessage('Oude tabkopie verwijderd. Tijdelijk bewaren kan opnieuw worden aangezet.')
      }
    } catch {
      setMessage('Kon de opgeslagen kopie niet wissen; je geopende boodschappen blijven intact.')
    }
  }
  function backupConfirm() {
    if (!backupPreview) return
    try {
      if (backupPreview.existing !== serializePrivateNotes(notes)) {
        setBackupPreview(null)
        setMessage('De lijst is na de voorinzage veranderd. Open de backup opnieuw om niets onverwachts toe te voegen.')
        return
      }
      const merged = mergePrivateNotes(notes, backupPreview.incoming)
      if (serializePrivateNotes(merged.notes) !==
          serializePrivateNotes([...notes, ...backupPreview.additions])) {
        throw Error('De backupvoorinzage is niet meer actueel.')
      }
      const previous = backupPreview.existing
      setNotes(current => serializePrivateNotes(current) === previous ? merged.notes : current)
      setLastImport({ source: 'JSON-backup', added: backupPreview.additions })
      setBackupPreview(null)
      setMessage(merged.added + ' boodschappen toegevoegd; bestaande items en vinkjes behouden.')
    } catch (error) {
      setBackupPreview(null)
      setMessage(error instanceof Error ? error.message : 'Import geweigerd.')
    }
  }

  function undoLastImport() {
    if (!lastImport?.added.length) return
    const ids = new Set(lastImport.added.map(item => item.id))
    const same = (a: UnpricedShoppingNote, b: UnpricedShoppingNote) =>
      a.id === b.id && a.label === b.label && a.store === b.store && a.done === b.done
    if (lastImport.added.some(item => !notes.some(current => same(current, item)))) {
      setLastImport(null)
      setMessage('De laatst geïmporteerde artikelen zijn gewijzigd. Herstellen geweigerd om je bewerkingen te bewaren.')
      return
    }
    setNotes(current => lastImport.added.every(item => current.some(row => same(row, item)))
      ? current.filter(item => !ids.has(item.id)) : current)
    setLastImport(null)
    setMessage('Alleen de laatst geïmporteerde ongeprijsde artikelen zijn verwijderd. Andere boodschappen, vinkjes en winkelprijzen blijven intact.')
  }

  async function readBulkText(file?: File) {
    const serial = ++bulkFileSerial.current
    if (!file) return
    try {
      if (!file.size || file.size > 15000) throw Error('TXT groter dan 15 kB of leeg.')
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (serial !== bulkFileSerial.current) return
      if (source.length > 15000) throw Error('Deze tekst past niet in het invulveld.')
      setBulkPreview(null)
      setBulkDraft(source)
      setMessage('Je eigen TXT is lokaal ingelezen; bekijk de tekst en klik zelf op toevoegen.')
    } catch (error) {
      if (serial === bulkFileSerial.current) setMessage(error instanceof Error ? error.message : 'TXT kon niet worden gelezen.')
    }
  }
  function downloadOwnCsv(mode: 'template' | 'all' | 'visible' = 'all') {
    // Keep the full private backup separate from a shareable filtered export.
    // Both use the same strict unpriced four-column CSV, never retailer data.
    const rows = mode === 'template'
      ? [{ label: '', store: 'Algemeen' as const, done: false }]
      : mode === 'visible' ? routeItems : notes
    if (rows.length === 0) return
    try {
      const uri = URL.createObjectURL(new Blob([exportUnpricedShoppingCsv(rows)], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = mode === 'template' ? 'supa-lege-ongeprijsde-boodschappen.csv'
          : mode === 'visible' ? 'supa-zichtbare-ongeprijsde-boodschappen.csv'
          : 'supa-eigen-ongeprijsde-boodschappen.csv'
        document.body.append(link); link.click(); link.remove()
        setMessage(mode === 'template'
          ? 'Leeg CSV-invulblad opgeslagen: vul artikel in en behoud de vier kolommen.'
          : mode === 'visible'
            ? rows.length + ' zichtbare eigen boodschappen voor jouw winkelronde geëxporteerd, met winkel en vinkje. Geen prijzen of SKU’s.'
            : 'Alle eigen boodschappen als CSV opgeslagen, zonder prijzen of SKU’s.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch { setMessage('Kon de ongeprijsde CSV niet bewaren.') }
  }
  async function copyOwnSpreadsheet() {
    // Export all privately entered notes, not the currently filtered rows.
    // The matching import route requires all four Supa columns.
    const snapshot = exportUnpricedShoppingTsv(notes)
    if (new TextEncoder().encode(snapshot).length > 32768) {
      setMessage('De spreadsheetlijst is te groot; download de CSV in plaats daarvan.')
      return
    }
    setSpreadsheetFallback('')
    try {
      if (!navigator.clipboard?.writeText) throw Error('clipboard unavailable')
      await navigator.clipboard.writeText(snapshot)
      setMessage('Alle eigen ongeprijsde boodschappen als vier kolommen gekopieerd. Plak in Excel/Calc, of plak de tabel later terug in Supa. Geen winkelprijzen.')
    } catch {
      setSpreadsheetFallback(snapshot)
      setMessage('Automatisch kopiëren is niet beschikbaar. Selecteer de vier kolommen hieronder en kopieer ze zelf.')
    }
  }
  function downloadOwnTsv(mode: 'all' | 'visible' = 'all') {
    const rows = mode === 'visible' ? routeItems : notes
    if (!rows.length) return
    try {
      const uri = URL.createObjectURL(new Blob([exportUnpricedShoppingTsv(rows)], {
        type: 'text/tab-separated-values;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = mode === 'visible'
          ? 'supa-zichtbare-ongeprijsde-boodschappen.tsv'
          : 'supa-eigen-ongeprijsde-boodschappen.tsv'
        document.body.append(link); link.click(); link.remove()
        setMessage(mode === 'visible'
          ? rows.length + ' zichtbare eigen boodschappen als Excel/Calc-TSV bewaard (zonder prijzen).'
          : 'Je hele eigen ongeprijsde lijst als Excel/Calc-TSV bewaard; geen SKU of bronprijzen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch { setMessage('Kon je eigen TSV-lijst niet bewaren.') }
  }
  function downloadOwnTsvTemplate() {
    // A blank personal Excel/Calc template, not retailer source evidence.
    // Deliberately no prices, SKUs, or inferred matches.
    const template = '\ufeffartikel\twinkel\tafgevinkt\r\n\tAlgemeen\tnee\r\n'
    try {
      const uri = URL.createObjectURL(new Blob([template], { type: 'text/tab-separated-values;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-leeg-eigen-boodschappenblad.tsv'
        document.body.append(link); link.click(); link.remove()
        setMessage('Leeg Excel/Calc-TSV-invulblad opgeslagen. Vul het artikel in en bewaar het als TSV.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
    } catch { setMessage('Kon het lege privé-TSV-invulblad niet bewaren.') }
  }
  function prepareOwnCsvPreview(source: string, pasted = false) {
    const incoming = pasted ? importUnpricedShoppingPaste(source) : importUnpricedShoppingCsv(source)
    const draft = incoming.map(item => (item.done ? '☑ ' : '☐ ') +
      '[' + item.store + '] ' + item.label).join('\n')
    if (draft.length > 15000) throw Error('Te veel tekst voor de voorinzage.')
    setBulkPreview(null)
    setBulkDraft(draft)
    setMessage(incoming.length + ' eigen spreadsheetartikelen ingelezen. Bekijk en bevestig via de bestaande ongeprijsde lijstimport.')
  }
  function preparePastedOwnCsv() {
    ++bulkFileSerial.current
    try { prepareOwnCsvPreview(ownCsvPaste, true) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Geplakte CSV geweigerd.') }
  }
  async function readOwnCsv(file?: File) {
    const serial = ++bulkFileSerial.current
    if (!file) return
    try {
      if (!file.size || file.size > 32768) throw Error('Kies een privé-CSV of TSV van maximaal 32 kB.')
      const extension = file.name.toLocaleLowerCase('nl-NL').split('.').at(-1)
      if (extension !== 'csv' && extension !== 'tsv')
        throw Error('Kies een .csv- of .tsv-bestand; geen prijslijst of werkmap.')
      const bytes = await file.arrayBuffer()
      if (serial !== bulkFileSerial.current) return
      const bom = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2))
      // Excel's 'Unicode Text' TSV uses an explicit UTF-16 BOM. Only accept
      // that legacy encoding for private TSV input; CSV remains strict UTF-8.
      const encoding = extension === 'tsv' && bom[0] === 0xff && bom[1] === 0xfe
        ? 'utf-16le' : extension === 'tsv' && bom[0] === 0xfe && bom[1] === 0xff
          ? 'utf-16be' : 'utf-8'
      const source = new TextDecoder(encoding, { fatal: true }).decode(bytes)
      // Existing strict spreadsheet clipboard parser also supports offline TSV files.
      // No retailer prices or SKUs: still requires explicit review and confirmation.
      prepareOwnCsvPreview(source, extension === 'tsv')
    } catch (error) {
      if (serial === bulkFileSerial.current) setMessage(error instanceof Error ? error.message : 'CSV of TSV geweigerd.')
    }
  }
  function addBulk(event: FormEvent) {
    event.preventDefault()
    // A Supa TXT export is a personal unpriced list, never retailer evidence.
    const exported = bulkDraft.trimStart().startsWith('SUPA · EIGEN ONGEPRIJSDE BOODSCHAPPEN · ')
    const parsed: { label: string; done: boolean; store: UnpricedShoppingNote['store'] }[] = []
    let invalid = false
    let headingStore = store
    for (const source of bulkDraft.split(/\r?\n/u)) {
      const row = source.trim().replace(/^(?:[-*•]\s+|\d{1,3}[.)]\s+)/u, '')
      if (!row) continue
      const groupHeading = /^(Algemeen|PLUS|DekaMarkt)\s*[:：]$/u.exec(row)
      if (!exported && groupHeading) {
        headingStore = groupHeading[1] as UnpricedShoppingNote['store']
        continue
      }
      if (exported && (row.startsWith('SUPA · EIGEN ONGEPRIJSDE BOODSCHAPPEN · ') ||
          row === 'Los van Planner, bronopnames, weekbudget en winkelmandtotalen.' ||
          row === 'Alleen nog open artikelen:' ||
          row === 'Geen winkelprijs, bronrecht of besparingsclaim.')) continue
      const done = /^(?:☑|\[[xX]\])(?:\s|$)/u.test(row)
      const content = row.replace(/^(?:☑|☐|\[[xX ]\])\s*/u, '')
      const tagged = /^\[(Algemeen|PLUS|DekaMarkt)\]\s+(.+)$/u.exec(content)
      if (exported && (!tagged || !tagged[2].endsWith(' · prijs onbekend'))) {
        invalid = true
        continue
      }
      const targetStore = tagged ? tagged[1] as UnpricedShoppingNote['store'] : headingStore
      const rawLabel = tagged ? tagged[2] : content
      const label = safeLabel(exported ? rawLabel.slice(0, -' · prijs onbekend'.length) : rawLabel)
      if (!label || label.length > 140) invalid = true
      else parsed.push({ label, done, store: targetStore })
    }
    if (invalid || !parsed.length || parsed.length > 100) {
      setMessage('Lijst ongeldig: maximaal 100 artikelen van 140 tekens; controleer de originele Supa TXT-regels.')
      return
    }
    const seen = new Set(notes.map(item => duplicateKey(item.store, item.label)))
    const distinct = parsed.filter(item => {
      const key = duplicateKey(item.store, item.label)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (notes.length + distinct.length > 100) {
      setMessage('Je lijst heeft ruimte voor maximaal 100 verschillende artikelen. Er is niets toegevoegd.')
      return
    }
    if (!distinct.length) {
      setBulkPreview(null)
      setMessage('Alle artikelen staan al op de gekozen winkellijsten. Bestaande vinkjes blijven behouden.')
      return
    }
    setBulkPreview({
      draft: bulkDraft, existing: serializePrivateNotes(notes), selectedStore: store,
      incoming: distinct, duplicateCount: parsed.length - distinct.length,
    })
    setMessage('Controleer de nieuwe ongeprijsde artikelen, winkels en vinkjes en bevestig daarna.')
  }
  function confirmBulk() {
    if (!bulkPreview) return
    try {
      if (bulkPreview.draft !== bulkDraft || bulkPreview.selectedStore !== store ||
          bulkPreview.existing !== serializePrivateNotes(notes)) {
        setBulkPreview(null)
        setMessage('Lijst, winkelselectie of invoer is ondertussen gewijzigd. Bekijk de import opnieuw.')
        return
      }
      const incoming = bulkPreview.incoming
      const existing = new Set(notes.map(item => duplicateKey(item.store, item.label)))
      if (notes.length + incoming.length > 100 ||
          incoming.some(item => existing.has(duplicateKey(item.store, item.label)))) {
        setBulkPreview(null)
        setMessage('Deze artikelen passen niet meer in de huidige lijst. Bekijk de import opnieuw.')
        return
      }
      const added = incoming.map(item => ({
        ...item, id: 'own-note-' + crypto.randomUUID(),
      }))
      const before = bulkPreview.existing
      setNotes(current => serializePrivateNotes(current) === before
        ? [...current, ...added] : current)
      setLastImport({ source: 'tekstlijst', added })
      setBulkDraft('')
      setBulkPreview(null)
      setMessage(incoming.length + ' eigen boodschappen toegevoegd, ' +
        bulkPreview.duplicateCount + ' dubbel overgeslagen. Originele vinkjes en winkels bewaard; geen prijzen.')
    } catch {
      setBulkPreview(null)
      setMessage('Import geweigerd vanwege een gewijzigde of ongeldige persoonlijke lijst.')
    }
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
    if (notes.length >= 100 || notes.some(note =>
      note.id === lastRemoved.note.id ||
      duplicateKey(note.store, note.label) === duplicateKey(lastRemoved.note.store, lastRemoved.note.label))) {
      setMessage('Herstellen kan niet: de lijst is vol of dit artikel staat inmiddels al bij deze winkel.')
      return
    }
    const { note, index } = lastRemoved
    setNotes(current => {
      if (current.length >= 100 || current.some(entry => entry.id === note.id ||
        duplicateKey(entry.store, entry.label) === duplicateKey(note.store, note.label))) return current
      const next = [...current]
      next.splice(Math.min(index, next.length), 0, note)
      return next
    })
    setLastRemoved(null)
    setMessage('De laatste eigen boodschap is met zijn oorspronkelijke vinkje hersteld.')
  }
  // Warn about buying the same still-open personal note at both retailers.
  // Never silently merge different shopping IDs or choose a cheaper store:
  // these notes contain no trustworthy prices or product identities.
  const openDekaLabels = new Set(notes.filter(note => note.store === 'DekaMarkt' && !note.done)
    .map(note => privateNoteLabelIdentity(note.label)))
  const duplicatedOpenRetailerNotes = notes.filter(note => note.store === 'PLUS' && !note.done &&
    openDekaLabels.has(privateNoteLabelIdentity(note.label)))
  const duplicateOpenLabels = Array.from(new Map(duplicatedOpenRetailerNotes.map(note =>
    [privateNoteLabelIdentity(note.label), note.label] as const)).values())
  function proposeDuplicateChoice(label: string, keep: 'PLUS' | 'DekaMarkt') {
    const key = privateNoteLabelIdentity(label)
    const plus = notes.find(note => note.store === 'PLUS' && !note.done &&
      privateNoteLabelIdentity(note.label) === key)
    const deka = notes.find(note => note.store === 'DekaMarkt' && !note.done &&
      privateNoteLabelIdentity(note.label) === key)
    if (!plus || !deka) {
      setPendingDuplicateChoice(null)
      setMessage('Deze dubbele boodschap is inmiddels veranderd. Bekijk de huidige lijst opnieuw.')
      return
    }
    setPendingDuplicateChoice({ plus: { ...plus }, deka: { ...deka }, keep })
  }
  function confirmDuplicateChoice() {
    const choice = pendingDuplicateChoice
    if (!choice) return
    const unchanged = (original: UnpricedShoppingNote) => notes.some(item =>
      item.id === original.id && item.label === original.label &&
      item.store === original.store && !item.done)
    if (!unchanged(choice.plus) || !unchanged(choice.deka)) {
      setPendingDuplicateChoice(null)
      setMessage('De dubbele boodschappen zijn veranderd; er is niets verwijderd.')
      return
    }
    const discarded = choice.keep === 'PLUS' ? choice.deka : choice.plus
    const index = notes.findIndex(item => item.id === discarded.id)
    if (index < 0) return
    setNotes(current => {
      const same = [choice.plus, choice.deka].every(original => current.some(item =>
        item.id === original.id && item.label === original.label &&
        item.store === original.store && !item.done))
      return same ? current.filter(item => item.id !== discarded.id) : current
    })
    setLastRemoved({ note: discarded, index })
    setPendingDuplicateChoice(null)
    setMessage('Eigen boodschap blijft alleen bij ' + choice.keep +
      '. De andere ongeprijsde regel is verwijderd; herstel via de knop onder de lijst.')
  }
  function prepareDuplicateBatch(keep: 'PLUS' | 'DekaMarkt') {
    const pairs = duplicatedOpenRetailerNotes.map(plus => {
      const key = privateNoteLabelIdentity(plus.label)
      const deka = notes.find(note => note.store === 'DekaMarkt' && !note.done &&
        privateNoteLabelIdentity(note.label) === key)
      return deka ? { plus: { ...plus }, deka: { ...deka } } : null
    }).filter((pair): pair is { plus: UnpricedShoppingNote; deka: UnpricedShoppingNote } =>
      pair !== null)
    if (!pairs.length) return
    setPendingDuplicateBatch({ keep, pairs })
  }
  function confirmDuplicateBatch() {
    const batch = pendingDuplicateBatch
    if (!batch?.pairs.length) return
    const unchanged = (current: UnpricedShoppingNote[]) => batch.pairs.every(pair =>
      [pair.plus, pair.deka].every(original => current.some(item =>
        item.id === original.id && item.store === original.store &&
        item.label === original.label && !item.done)))
    if (!unchanged(notes)) {
      setPendingDuplicateBatch(null)
      setMessage('De dubbele boodschappen zijn veranderd. Kies de winkel opnieuw.')
      return
    }
    const removed = batch.pairs.map(pair => {
      const note = batch.keep === 'PLUS' ? pair.deka : pair.plus
      return { note, index: notes.findIndex(item => item.id === note.id) }
    })
    if (removed.some(item => item.index < 0)) return
    const ids = new Set(removed.map(item => item.note.id))
    setNotes(current => unchanged(current) ? current.filter(item => !ids.has(item.id)) : current)
    setLastDuplicateBatch(removed)
    setPendingDuplicateBatch(null)
    setMessage(removed.length + ' open dubbele eigen boodschappen verwijderd van de andere winkel. ' +
      'Je originele prijzen en geprijsde productmatches blijven onaangeraakt.')
  }
  function undoDuplicateBatch() {
    const batch = lastDuplicateBatch
    if (!batch?.length) return
    const canRestore = (current: UnpricedShoppingNote[]) => {
      if (current.length + batch.length > 100) return false
      const ids = new Set(current.map(item => item.id))
      const keys = new Set(current.map(item => duplicateKey(item.store, item.label)))
      return batch.every(({ note }) =>
        !ids.has(note.id) && !keys.has(duplicateKey(note.store, note.label)))
    }
    if (!canRestore(notes)) {
      setLastDuplicateBatch(null)
      setMessage('Herstel geweigerd: de lijst is gewijzigd of de winkel heeft nu al deze artikelen.')
      return
    }
    setNotes(current => {
      if (!canRestore(current)) return current
      const restored = [...current]
      for (const item of [...batch].sort((a, b) => a.index - b.index))
        restored.splice(Math.min(item.index, restored.length), 0, item.note)
      return restored
    })
    setLastDuplicateBatch(null)
    setMessage('De eerdere dubbele eigen boodschappen zijn met hun originele winkel en vinkjes hersteld.')
  }
  const retailerOpenKeys = new Set(notes.filter(note =>
    note.store !== 'Algemeen' && !note.done).map(note =>
    privateNoteLabelIdentity(note.label)))
  const redundantGeneralNotes = notes.filter(note => note.store === 'Algemeen' &&
    !note.done && retailerOpenKeys.has(privateNoteLabelIdentity(note.label)))
  function confirmGeneralDuplicates() {
    const selected = pendingGeneralDuplicates
    if (!selected?.length) return
    const keys = new Set(notes.filter(note => note.store !== 'Algemeen' && !note.done)
      .map(note => privateNoteLabelIdentity(note.label)))
    const valid = selected.every(note => notes.some(current =>
      current.id === note.id && current.store === 'Algemeen' &&
      current.label === note.label && !current.done) &&
      keys.has(privateNoteLabelIdentity(note.label)))
    if (!valid) {
      setPendingGeneralDuplicates(null)
      setMessage('Algemene of winkelgebonden boodschappen zijn inmiddels veranderd. Controleer opnieuw.')
      return
    }
    const removed = selected.map(note => ({ note, index: notes.findIndex(item => item.id === note.id) }))
    const ids = new Set(selected.map(note => note.id))
    setNotes(current => {
      const storeKeys = new Set(current.filter(item => item.store !== 'Algemeen' && !item.done)
        .map(item => privateNoteLabelIdentity(item.label)))
      return selected.every(note => current.some(item => item.id === note.id &&
        item.store === 'Algemeen' && item.label === note.label && !item.done) &&
        storeKeys.has(privateNoteLabelIdentity(note.label)))
        ? current.filter(item => !ids.has(item.id)) : current
    })
    setLastGeneralDuplicates(removed)
    setPendingGeneralDuplicates(null)
    setMessage(selected.length + ' dubbele open algemene boodschappen opgeruimd. ' +
      'De bestaande winkelgebonden artikelen en hun vinkjes blijven behouden.')
  }
  function undoGeneralDuplicates() {
    const removed = lastGeneralDuplicates
    if (!removed?.length) return
    const valid = (current: UnpricedShoppingNote[]) => {
      const ids = new Set(current.map(item => item.id))
      const keys = new Set(current.map(item => duplicateKey(item.store, item.label)))
      return current.length + removed.length <= 100 && removed.every(({ note }) =>
        !ids.has(note.id) && !keys.has(duplicateKey(note.store, note.label)))
    }
    if (!valid(notes)) {
      setLastGeneralDuplicates(null)
      setMessage('Herstel geweigerd omdat de lijst nu conflicterende algemene boodschappen bevat.')
      return
    }
    setNotes(current => {
      if (!valid(current)) return current
      const restored = [...current]
      for (const entry of [...removed].sort((a, b) => a.index - b.index))
        restored.splice(Math.min(entry.index, restored.length), 0, entry.note)
      return restored
    })
    setLastGeneralDuplicates(null)
    setMessage('Algemene boodschappen met hun oorspronkelijke vinkjes en ID’s hersteld.')
  }
  const selected = notes.filter(note => filterStore === 'Alle winkels' ||
    note.store === filterStore || note.store === 'Algemeen')
  // Search only the shopper's own notes. Never infer a retailer identity.
  const needle = search.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl').trim()
  const visible = selected.filter(note => (!onlyOpen || !note.done) &&
    (!needle || note.label.normalize('NFKD').replace(/\p{M}/gu, '')
      .toLocaleLowerCase('nl').includes(needle)))
  const shopRoute: readonly UnpricedShoppingNote['store'][] = [
    firstShop, firstShop === 'PLUS' ? 'DekaMarkt' : 'PLUS', 'Algemeen',
  ]
  const grouped = shopRoute.map(groupStore => ({
    store: groupStore, items: visible.filter(note => note.store === groupStore),
  })).filter(group => group.items.length > 0)
  const nextOpenStore = grouped.find(group => group.items.some(item => !item.done))?.store ?? null
  function goToStore(groupStore: UnpricedShoppingNote['store']) {
    const target = document.getElementById('supa-own-trip-' + groupStore)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target?.focus({ preventScroll: true })
  }
  const visibleIds = new Set(visible.map(note => note.id))
  const remainingVisible = visible.filter(note => !note.done).length
  const completedVisible = visible.length - remainingVisible
  function samePersonalRound(original: UnpricedShoppingNote[], current: UnpricedShoppingNote[], unchecked = false) {
    if (original.length !== current.length) return false
    const expected = new Map(original.map(item => [item.id, item]))
    return current.every(item => {
      const prev = expected.get(item.id)
      return !!prev && prev.label === item.label && prev.store === item.store &&
        (unchecked ? !item.done : prev.done === item.done)
    })
  }
  function confirmNextRound() {
    if (!pendingNextRound?.length) return
    const original = pendingNextRound
    if (!samePersonalRound(original, notes)) {
      setPendingNextRound(null)
      setMessage('Je eigen boodschappenlijst is intussen gewijzigd. Controleer deze eerst opnieuw.')
      return
    }
    setNotes(current => samePersonalRound(original, current)
      ? current.map(item => item.done ? { ...item, done: false } : item) : current)
    setLastNextRound(original)
    setPendingNextRound(null)
    setMessage('Nieuwe winkelronde: alle eigen vinkjes weer opengezet. Winkels, volgorde en prijzen onveranderd.')
  }
  function undoNextRound() {
    if (!lastNextRound?.length) return
    const original = lastNextRound
    if (!samePersonalRound(original, notes, true)) {
      setLastNextRound(null)
      setMessage('Herstellen geweigerd: de nieuwe lijst is intussen veranderd.')
      return
    }
    setNotes(current => samePersonalRound(original, current, true)
      ? current.map(item => ({ ...item, done: !!original.find(old => old.id === item.id)?.done })) : current)
    setLastNextRound(null)
    setMessage('De eerdere persoonlijke afvinkstatus is hersteld.')
  }
  function confirmClearCompleted() {
    if (!pendingCleared?.length) return
    const originals = pendingCleared.map(item => ({
      note: item, index: notes.findIndex(current => current.id === item.id),
    }))
    if (originals.some(({ note, index }) => index < 0 ||
        !notes[index].done || notes[index].label !== note.label ||
        notes[index].store !== note.store)) {
      setPendingCleared(null)
      setMessage('Boodschappen zijn ondertussen veranderd. Bekijk de huidige afvinkingen opnieuw.')
      return
    }
    const ids = new Set(pendingCleared.map(item => item.id))
    setNotes(current => {
      if (originals.some(({ note }) => !current.some(item => item.id === note.id &&
          item.done && item.label === note.label && item.store === note.store))) return current
      return current.filter(item => !ids.has(item.id))
    })
    setLastCleared(originals)
    setPendingCleared(null)
    setMessage(originals.length + ' afgeronde eigen boodschappen uit de actieve lijst gehaald. Herstel mogelijk; geen geprijsde regels gewijzigd.')
  }
  function undoCleared() {
    if (!lastCleared?.length) return
    const ids = new Set(lastCleared.map(item => item.note.id))
    const labels = new Set(notes.map(item => duplicateKey(item.store, item.label)))
    if (notes.length + lastCleared.length > 100 ||
        notes.some(item => ids.has(item.id)) ||
        lastCleared.some(({ note }) => labels.has(duplicateKey(note.store, note.label)))) {
      setMessage('Herstellen kan niet: er zijn nieuwe conflicterende artikelen of de lijst is vol.')
      return
    }
    setNotes(current => {
      const currentKeys = new Set(current.map(item => duplicateKey(item.store, item.label)))
      if (current.length + lastCleared.length > 100 ||
          current.some(item => ids.has(item.id)) ||
          lastCleared.some(({ note }) => currentKeys.has(duplicateKey(note.store, note.label)))) return current
      const next = [...current]
      for (const { note, index } of [...lastCleared].sort((a, b) => a.index - b.index))
        next.splice(Math.min(index, next.length), 0, note)
      return next
    })
    setLastCleared(null)
    setMessage('Afgeronde boodschappen teruggezet op hun oorspronkelijke plek, met oorspronkelijke vinkjes.')
  }
  function markVisible(done: boolean) {
    if (visibleIds.size === 0) return
    setNotes(current => current.map(item => visibleIds.has(item.id) && item.done !== done
      ? { ...item, done } : item))
    setMessage((done ? 'Zichtbare boodschappen afgevinkt' : 'Zichtbare boodschappen weer opengezet') +
      '; andere winkels en oorspronkelijke prijsdata blijven onaangeroerd.')
  }
  function markGroup(groupStore: UnpricedShoppingNote['store'], checked: boolean) {
    const ids = new Set(visible.filter(item => item.store === groupStore).map(item => item.id))
    if (ids.size === 0) return
    setNotes(current => current.map(item => ids.has(item.id) && item.done !== checked
      ? { ...item, done: checked } : item))
    setMessage(groupStore + ': alleen de zichtbare persoonlijke boodschappen ' +
      (checked ? 'afgevinkt.' : 'weer opengezet.') + ' Geen prijzen veranderd.')
  }
  function moveOwnNoteWithinStore(id: string, direction: -1 | 1) {
    // Order is private presentation data, never a change in product identity,
    // retailer provenance, quantities, source prices or checklist state.
    const sameStore = notes.filter(item => item.store === notes.find(note => note.id === id)?.store)
    const position = sameStore.findIndex(item => item.id === id)
    const neighbor = sameStore[position + direction]
    const moving = sameStore[position]
    if (!moving || !neighbor || onlyOpen || needle) return
    setNotes(current => {
      const left = current.findIndex(item => item.id === moving.id)
      const right = current.findIndex(item => item.id === neighbor.id)
      if (left < 0 || right < 0) return current
      const latest = current.filter(item => item.store === moving.store)
      const currentPosition = latest.findIndex(item => item.id === moving.id)
      if (latest[currentPosition + direction]?.id !== neighbor.id ||
          current[left].label !== moving.label || current[left].done !== moving.done ||
          current[right].label !== neighbor.label || current[right].done !== neighbor.done ||
          current[right].store !== moving.store) return current
      const reordered = [...current]
      ;[reordered[left], reordered[right]] = [reordered[right], reordered[left]]
      return reordered
    })
    setMessage('Persoonlijke boodschappenvolgorde aangepast. TXT en print volgen de winkelvolgorde; originele bronprijzen blijven onaangeroerd.')
  }
  function moveVisibleOwnNotes(from: UnpricedShoppingNote['store'], selectedOnly = false) {
    const target = moveTargets[from]
    const selected = new Set(selectedMoveIds)
    const candidates = visible.filter(note => note.store === from &&
      (!selectedOnly || selected.has(note.id)))
    if (!candidates.length || target === from) return
    const existing = new Set(notes.filter(item => item.store === target)
      .map(item => duplicateKey(item.store, item.label)))
    if (candidates.some(item => existing.has(duplicateKey(target, item.label)))) {
      setMessage('Er bestaan al artikelen bij ' + target +
        '. Niets verplaatst: bekijk eerst de dubbele boodschappen.')
      return
    }
    // Snapshot the actual values to prevent a delayed user action from
    // overwriting independent changes to shopping content or completion.
    const byId = new Map(candidates.map(item => [item.id, item] as const))
    setNotes(current => {
      const currentTargetKeys = new Set(current.filter(item => item.store === target)
        .map(item => duplicateKey(item.store, item.label)))
      if (candidates.some(note => {
        const actual = current.find(item => item.id === note.id)
        return !actual || actual.store !== from || actual.label !== note.label ||
          actual.done !== note.done ||
          currentTargetKeys.has(duplicateKey(target, note.label))
      })) return current
      return current.map(item => byId.has(item.id) ? { ...item, store: target } : item)
    })
    setLastGroupMove({ from, to: target, items: candidates.map(({ id, label, done }) => ({ id, label, done })) })
    setSelectedMoveIds(current => current.filter(id => !candidates.some(note => note.id === id)))
    setMessage(candidates.length + ' eigen boodschappen van ' + from + ' naar ' + target +
      ' verplaatst met behoud van de vinkjes. Prijzen en artikelmatching blijven onaangeroerd.')
  }
  function undoGroupMove() {
    if (!lastGroupMove) return
    const { from, to, items } = lastGroupMove
    const expected = new Map(items.map(item => [item.id, item]))
    const sourceKeys = new Set(notes.filter(item => item.store === from)
      .map(item => duplicateKey(from, item.label)))
    if (items.some(item => {
      const actual = notes.find(candidate => candidate.id === item.id)
      return !actual || actual.store !== to || actual.label !== item.label ||
        actual.done !== item.done || sourceKeys.has(duplicateKey(from, item.label))
    })) {
      setLastGroupMove(null)
      setMessage('De verplaatste lijst is intussen gewijzigd of bevat nu dubbelen. Herstellen is veilig geweigerd.')
      return
    }
    setNotes(current => {
      const sourceNow = new Set(current.filter(item => item.store === from)
        .map(item => duplicateKey(from, item.label)))
      if (items.some(item => {
        const actual = current.find(candidate => candidate.id === item.id)
        return !actual || actual.store !== to || actual.label !== item.label ||
          actual.done !== item.done || sourceNow.has(duplicateKey(from, item.label))
      })) return current
      return current.map(item => expected.has(item.id) ? { ...item, store: from } : item)
    })
    setLastGroupMove(null)
    setMessage(items.length + ' persoonlijke artikelen teruggezet van ' + to + ' naar ' + from +
      '. De originele vinkjes blijven behouden; winkelprijzen en SKU’s zijn niet gewijzigd.')
  }
  const routeItems = grouped.flatMap(group => group.items)
  const selectedVisible = routeItems.filter(note => selectedMoveIds.includes(note.id))
  function formatOwnList(items: UnpricedShoppingNote[]) {
    return [
      'SUPA · EIGEN ONGEPRIJSDE BOODSCHAPPEN · ' + filterStore,
      'Los van Planner, bronopnames, weekbudget en winkelmandtotalen.', '',
      ...(onlyOpen ? ['Alleen nog open artikelen:'] : []),
      ...items.map(note => (note.done ? '☑ ' : '☐ ') +
        `[${note.store}] ${safeLabel(note.label)} · prijs onbekend`),
      '', 'Geen winkelprijs, bronrecht of besparingsclaim.',
    ].join('\n') + '\n'
  }
  const exportText = formatOwnList(routeItems)
  const selectedExportText = formatOwnList(selectedVisible)
  function saveRepeatTemplate() {
    if (repeatProtected || !selectedVisible.length) return
    try {
      const actual = window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY)
      if (actual !== repeatRaw) {
        setRepeatProtected(true)
        throw Error('Een andere versie is opgeslagen. Niets overschreven.')
      }
      const raw = makePrivateShoppingTemplate(repeatName, selectedVisible)
      if (repeatRaw !== null && !window.confirm('Vervang je eerder bewaarde eigen herhaalronde? Je geopende boodschappen blijven behouden.')) return
      // Recheck after the user has reviewed the replacement dialog.
      if (window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== actual)
        throw Error('Herhaalronde is intussen gewijzigd; vervangen geweigerd.')
      window.localStorage.setItem(PRIVATE_SHOPPING_TEMPLATE_KEY, raw)
      setRepeatRaw(raw)
      setRepeatPreview(null)
      setRepeatFilePreview(null)
      setRepeatMessage(selectedVisible.length + ' zichtbare geselecteerde eigen artikelen als herhaalronde bewaard, zonder vinkjes of prijzen.')
    } catch (error) {
      // An invalid draft name is editable; never lock the user's UI simply
      // because an incomplete title was rejected before anything was stored.
      setRepeatMessage(error instanceof Error ? error.message : 'Sjabloon kon niet worden bewaard.')
    }
  }
  function prepareRepeatTemplate() {
    setRepeatPreview(null)
    if (repeatProtected || !repeatRaw) return
    try {
      if (window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== repeatRaw)
        throw Error('Herhaalronde is intussen gewijzigd. Open geen verouderde kopie.')
      const template = parsePrivateShoppingTemplate(repeatRaw)
      const known = new Set(notes.map(note => privateNoteDuplicateKey(note.store, note.label)))
      const additions = template.items.filter(note => !known.has(privateNoteDuplicateKey(note.store, note.label)))
      const capacity = 100 - notes.length
      // Export/print a complete saved selection even if the active list is
      // full. Only the separate explicit "add to active list" action must fit
      // its 100-line limit; do not silently truncate either operation.
      const selectedIndices = additions.map((_, index) => index)
      setRepeatPreview({
        name: template.name, raw: repeatRaw, original: serializePrivateNotes(notes),
        additions, skipped: template.items.length - additions.length, selectedIndices,
      })
      setRepeatMessage(additions.length + ' nieuwe eigen artikelen gevonden.' +
        (additions.length > capacity
          ? ' Voor toevoegen is plaats voor ' + capacity + ' artikelen; afdrukken en delen kan met alle gekozen artikelen.'
          : ' Controleer de selectie en bevestig voordat ze worden toegevoegd.'))
    } catch (error) {
      setRepeatProtected(true)
      setRepeatMessage(error instanceof Error ? error.message : 'Herhaalronde is niet beschikbaar.')
    }
  }
  function selectRepeatTemplateStore(shop: UnpricedShoppingNote['store']) {
    setRepeatPreview(current => current ? {
      ...current,
      selectedIndices: current.additions
        .map((item, index) => item.store === shop ? index : -1)
        .filter(index => index >= 0),
    } : current)
  }
  function confirmRepeatTemplate() {
    const preview = repeatPreview
    if (!preview) return
    try {
      if (window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== preview.raw ||
          repeatRaw !== preview.raw || serializePrivateNotes(notes) !== preview.original)
        throw Error('Sjabloon of boodschappen zijn intussen gewijzigd. Open de voorinzage opnieuw.')
      const known = new Set(notes.map(note => privateNoteDuplicateKey(note.store, note.label)))
      const selected = new Set(preview.selectedIndices)
      if (!selected.size || selected.size !== preview.selectedIndices.length ||
          [...selected].some(index => !Number.isSafeInteger(index) || index < 0 || index >= preview.additions.length))
        throw Error('Kies minstens één geldig artikel voor deze winkelronde.')
      const chosen = preview.additions.filter((_, index) => selected.has(index))
      if (notes.length + chosen.length > 100 ||
          chosen.some(note => known.has(privateNoteDuplicateKey(note.store, note.label))))
        throw Error('De gekozen artikelen passen niet meer in de huidige lijst; niets toegevoegd.')
      const added = chosen.map(item => ({
        ...item, done: false, id: 'own-note-' + crypto.randomUUID(),
      }))
      setNotes(current => serializePrivateNotes(current) === preview.original
        ? [...current, ...added] : current)
      setLastImport({ source: 'sjabloon', added })
      setRepeatPreview(null)
      setRepeatMessage(added.length + ' gekozen ongeprijsde artikelen toegevoegd; ' +
        (preview.additions.length - added.length) + ' niet geselecteerd. Bestaande vinkjes en winkels behouden.')
    } catch (error) {
      setRepeatPreview(null)
      setRepeatMessage(error instanceof Error ? error.message : 'Herhaalronde geweigerd.')
    }
  }
  function selectedRepeatRoundItems(): { name: string; items: PrivateShoppingTemplateItem[] } {
    const preview = repeatPreview
    if (!preview || !preview.selectedIndices.length ||
        preview.raw !== repeatRaw ||
        window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== preview.raw ||
        preview.original !== serializePrivateNotes(notes))
      throw Error('Je lijst of opgeslagen herhaalronde is veranderd. Bekijk de selectie opnieuw.')
    const selected = new Set(preview.selectedIndices)
    if (selected.size !== preview.selectedIndices.length ||
        [...selected].some(index => !Number.isSafeInteger(index) || index < 0 || index >= preview.additions.length) ||
        selected.size > preview.additions.length)
      throw Error('Ongeldige selectie. Kies je artikelen opnieuw.')
    return {
      name: preview.name,
      items: preview.additions.filter((_, index) => selected.has(index)),
    }
  }
  function selectedRepeatRoundText(): string {
    const { name, items } = selectedRepeatRoundItems()
    return [
      'SUPA · PRIVÉ HERHAALRONDE · ' + name,
      'Uitsluitend door jou gekozen eigen boodschappen; geen winkelprijzen of productmatching.', '',
      ...items.map(item => '☐ [' + item.store + '] ' + item.label),
      '', 'Geen supermarktbron, SKU, besparingsclaim of automatische opslag.', '',
    ].join('\n')
  }
  function downloadSelectedRepeatRoundPrint() {
    try {
      // Recheck current source, selected items and available capacity at the
      // moment of download. A saved template is not a product/price source.
      const { name, items } = selectedRepeatRoundItems()
      const escapeHtml = (value: string) => value.replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
      const groups = stores.flatMap(shop => {
        const own = items.filter(item => item.store === shop)
        if (!own.length) return []
        return ['<section><h2>' + shop + ' · ' + own.length + ' artikelen</h2><ul>' +
          own.map(item => '<li><span aria-hidden="true">☐</span> ' +
            escapeHtml(item.label) + '</li>').join('') + '</ul></section>']
      }).join('')
      const html = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
        '<title>SUPA · Privé herhaalronde</title>' +
        '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:auto;padding:24px;color:#202820}' +
        'section{break-inside:avoid;border-top:2px solid #ccc;margin:16px 0;padding:12px 0}' +
        'ul{padding:0;list-style:none}li{padding:7px 0;border-bottom:1px solid #ddd;overflow-wrap:anywhere}' +
        'li span{font-size:1.3em;margin-right:.6em}small{color:#555}' +
        '@media print{body{padding:0}section{break-inside:avoid}}</style></head><body>' +
        '<h1>' + escapeHtml(name) + '</h1><p>' + items.length +
        ' bewust gekozen artikelen · niet toegevoegd aan de actieve lijst.</p>' +
        groups + '<footer><small>Persoonlijke ongeprijsde herhaalronde. ' +
        'Geen retailerbron, beschikbaarheidsclaim, SKU of besparing.</small></footer></body></html>'
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-geselecteerde-herhaalronde-print.html'
        document.body.append(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setRepeatMessage('Afdrukbaar winkelblad met ' + items.length +
        ' gekozen artikelen per winkel gedownload. De actieve lijst bleef gelijk.')
    } catch (error) {
      setRepeatPreview(null)
      setRepeatMessage(error instanceof Error ? error.message : 'Afdrukbaar winkelblad kon niet worden gemaakt.')
    }
  }
  function downloadSelectedRepeatRoundText() {
    try {
      const text = selectedRepeatRoundText()
      const uri = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-geselecteerde-herhaalronde.txt'
        document.body.append(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
      setRepeatMessage('Je gekozen, ongeprijsde herhaalartikelen zijn als TXT gedownload. De actieve lijst bleef gelijk.')
    } catch (error) {
      setRepeatPreview(null)
      setRepeatMessage(error instanceof Error ? error.message : 'De gekozen herhaalronde kon niet worden gedownload.')
    }
  }
  async function shareSelectedRepeatRoundText() {
    try {
      const text = selectedRepeatRoundText()
      if (typeof navigator.share !== 'function') {
        downloadSelectedRepeatRoundText()
        return
      }
      await navigator.share({ title: 'Mijn SUPA herhaalronde', text })
      setRepeatMessage('Alleen je gekozen, ongeprijsde herhaalartikelen zijn naar het mobiele deelmenu gestuurd.')
    } catch (error) {
      setRepeatMessage(error instanceof DOMException && error.name === 'AbortError'
        ? 'Mobiel delen geannuleerd; je huidige boodschappen zijn ongewijzigd.'
        : error instanceof Error ? error.message : 'Delen niet beschikbaar. Gebruik de TXT-download.')
    }
  }
  function downloadSelectedRepeatTemplate() {
    if (!selectedVisible.length) return
    try {
      // A portable copy is available without granting permanent storage.
      // The user's explicit file download is the sole persistence action.
      const raw = makePrivateShoppingTemplate(repeatName, selectedVisible)
      const url = URL.createObjectURL(new Blob([raw + '\n'], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-geselecteerde-herhaalronde.json'
        document.body.append(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setRepeatMessage(selectedVisible.length + ' eigen geselecteerde artikelen als herbruikbare JSON opgeslagen, ook zonder apparaatopslag.')
    } catch (error) {
      setRepeatMessage(error instanceof Error ? error.message : 'Geselecteerde herhaalronde kon niet worden gedownload.')
    }
  }
  function downloadRepeatTemplate() {
    if (repeatProtected || !repeatRaw) return
    try {
      if (window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== repeatRaw)
        throw Error('Het bewaarde sjabloon is intussen gewijzigd.')
      const template = parsePrivateShoppingTemplate(repeatRaw)
      const url = URL.createObjectURL(new Blob([repeatRaw + '\n'], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-prive-herhaalronde.json'
        document.body.append(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setRepeatMessage(template.items.length + ' artikelen in je eigen herhaalronde veilig als JSON bewaard.')
    } catch (error) {
      setRepeatMessage(error instanceof Error ? error.message : 'Kon privé-sjabloon niet downloaden.')
    }
  }
  async function readRepeatTemplateFile(file?: File) {
    const serial = ++repeatFileSerial.current
    setRepeatFilePreview(null)
    if (!file) return
    try {
      if (!file.name.toLocaleLowerCase('nl-NL').endsWith('.json') ||
          !file.size || file.size > PRIVATE_SHOPPING_TEMPLATE_MAX_BYTES)
        throw Error('Kies een Supa-herhaalronde als JSON van maximaal 32 kB.')
      const bytes = await file.arrayBuffer()
      if (serial !== repeatFileSerial.current) return
      if (!bytes.byteLength || bytes.byteLength > PRIVATE_SHOPPING_TEMPLATE_MAX_BYTES)
        throw Error('Privé-sjabloon is leeg of te groot.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
      const template = parsePrivateShoppingTemplate(text)
      const current = window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY)
      if (current !== repeatRaw || repeatProtected)
        throw Error('Opgeslagen sjabloon wijkt af of is beschermd. Niets overschreven.')
      setRepeatFilePreview({ raw: text, name: template.name, items: template.items, previous: current })
      setRepeatMessage('Controleer dit privé-sjabloon en bevestig eerst de lokale import.')
    } catch (error) {
      if (serial === repeatFileSerial.current)
        setRepeatMessage(error instanceof Error ? error.message : 'Sjabloonbestand geweigerd.')
    }
  }
  function confirmRepeatTemplateFile() {
    const preview = repeatFilePreview
    if (!preview || repeatProtected) return
    try {
      if (repeatRaw !== preview.previous ||
          window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== preview.previous)
        throw Error('Een ander sjabloon is intussen opgeslagen. Import geweigerd.')
      const template = parsePrivateShoppingTemplate(preview.raw)
      if (preview.previous !== null && !window.confirm('Vervang je huidige bewaarde herhaalronde door dit aangeleverde privé-sjabloon?')) return
      if (window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== preview.previous)
        throw Error('Het sjabloon is tijdens bevestiging gewijzigd. Import geweigerd.')
      window.localStorage.setItem(PRIVATE_SHOPPING_TEMPLATE_KEY, preview.raw)
      setRepeatRaw(preview.raw)
      setRepeatName(template.name)
      setRepeatPreview(null)
      setRepeatFilePreview(null)
      setRepeatMessage(template.items.length + ' eigen sjabloonartikelen opgeslagen. Ze zijn nog niet aan de actieve lijst toegevoegd.')
    } catch (error) {
      setRepeatFilePreview(null)
      setRepeatMessage(error instanceof Error ? error.message : 'Sjabloonimport geweigerd.')
    }
  }
  function deleteRepeatTemplate() {
    try {
      const before = window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY)
      if (before === null) return
      if (!window.confirm('Verwijder je bewaarde herhaalronde op dit apparaat? Je huidige boodschappen blijven behouden.')) return
      if (window.localStorage.getItem(PRIVATE_SHOPPING_TEMPLATE_KEY) !== before)
        throw Error('Het sjabloon veranderde tijdens de bevestiging; verwijderen geweigerd.')
      window.localStorage.removeItem(PRIVATE_SHOPPING_TEMPLATE_KEY)
      setRepeatRaw(null)
      setRepeatProtected(false)
      setRepeatPreview(null)
      setRepeatFilePreview(null)
      setRepeatMessage('Alleen je bewaarde herhaalronde verwijderd. Je actieve privéboodschappen blijven staan.')
    } catch (error) {
      setRepeatMessage(error instanceof Error ? error.message : 'Sjabloon kon niet worden verwijderd.')
    }
  }
  async function shareSelectedPersonalNotes() {
    if (!selectedVisible.length) return
    // Share sheet is explicitly user-initiated and receives ONLY selected,
    // currently visible own notes. No retailer provenance, price or budget.
    if (typeof navigator.share !== 'function') {
      downloadSelected()
      setMessage('Mobiel delen is niet beschikbaar. Alleen je zichtbare selectie is als ongeprijsd TXT-bestand opgeslagen.')
      return
    }
    try {
      await navigator.share({
        title: 'Mijn geselecteerde ongeprijsde boodschappen',
        text: selectedExportText,
      })
      setMessage('Alleen je geselecteerde persoonlijke boodschappen zijn aan het mobiele deelmenu aangeboden.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMessage('Delen geannuleerd; je geselecteerde boodschappen zijn niet aangepast.')
      } else {
        downloadSelected()
        setMessage('Delen niet toegestaan. Alleen je zichtbare selectie is als privé-TXT opgeslagen.')
      }
    }
  }
  async function sharePersonalShoppingList() {
    if (!visible.length) return
    // Only the currently visible personal notes are shared, after an explicit
    // tap. Never include an imported retailer price, SKU, source or budget.
    // The OS share sheet is user-controlled; Supa does not transmit the text.
    if (typeof navigator.share !== 'function') {
      setExportVisible(true)
      setMessage('Delen is niet beschikbaar in deze browser. Selecteer hieronder jouw privéboodschappen om ze te kopiëren.')
      return
    }
    try {
      await navigator.share({ title: 'Mijn eigen ongeprijsde boodschappen', text: exportText })
      setMessage('Je zichtbare persoonlijke boodschappen zijn via het deelmenu aangeboden.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMessage('Delen geannuleerd; je persoonlijke boodschappen zijn niet aangepast.')
      } else {
        setExportVisible(true)
        setMessage('Delen werd niet toegestaan. De geselecteerde kopieertekst staat hieronder, zonder prijsinformatie.')
      }
    }
  }
  async function copyPersonalShoppingList() {
    if (!visible.length) return
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(exportText)
      setMessage('Alleen je zichtbare ongeprijsde boodschappen zijn gekopieerd.')
    } catch {
      setExportVisible(true)
      setMessage('Automatisch kopiëren is niet toegestaan. Selecteer de privétekst hieronder om zelf te kopiëren.')
    }
  }
  function downloadPrintableList() {
    if (!visible.length) return
    // Static local HTML only: encode all user text and deny external resources.
    const escapeHtml = (text: string) => text.replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
    const groups = shopRoute.flatMap(shop => {
      const items = visible.filter(note => note.store === shop)
      if (!items.length) return []
      return ['<section><h2>' + shop + '</h2><p>' +
        items.filter(note => !note.done).length + ' open van ' + items.length + '</p><ul>' +
        items.map(note => '<li><span aria-hidden="true">' + (note.done ? '☑' : '☐') +
          '</span> ' + escapeHtml(safeLabel(note.label)) + '</li>').join('') +
        '</ul></section>']
    }).join('')
    const html = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
      '<title>SUPA · Eigen ongeprijsde boodschappen</title>' +
      '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:auto;padding:24px;color:#202820}' +
      'section{break-inside:avoid;border-top:2px solid #ccc;margin:16px 0;padding:12px 0}' +
      'ul{padding:0;list-style:none}li{padding:7px 0;border-bottom:1px solid #ddd;overflow-wrap:anywhere}' +
      'li span{font-size:1.3em;margin-right:.6em}small{color:#555}' +
      '@media print{body{padding:0}section{break-inside:avoid}}</style></head><body>' +
      '<h1>Mijn eigen boodschappen</h1><p>' + visible.length +
      ' ongeprijsde items, ' + visible.filter(note => !note.done).length +
      ' nog te kopen.</p>' + groups +
      '<footer><small>Persoonlijke lijst zonder winkelprijzen. Geen winkelvergelijking, bronbewijs of besparingsclaim.</small></footer>' +
      '</body></html>'
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-eigen-boodschappen-print.html'
      document.body.append(link); link.click(); link.remove()
      setMessage('De zichtbare ongeprijsde boodschappen zijn als offline printbestand bewaard.')
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }
  function downloadSelected() {
    if (!selectedVisible.length) return
    // Only selected and currently visible self-entered notes; no price inputs.
    const uri = URL.createObjectURL(new Blob([selectedExportText], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = uri
      link.download = 'supa-geselecteerde-ongeprijsde-boodschappen.txt'
      document.body.append(link); link.click(); link.remove()
      setMessage(selectedVisible.length + ' geselecteerde eigen boodschappen als TXT opgeslagen zonder prijzen.')
    } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
  }
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
      jouw toestemming kunnen de vinkjes en artikelen in deze browsertab of langer
      op dit apparaat blijven staan. Nooit meegenomen in weekbudget, twee winkelmanden
      of prijsverschil; sluit je de tab zonder apparaatopslag, dan vervalt de lijst.</p>
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
          Gewone regels gaan naar {store}; bij gekopieerde Supa-TXT met [PLUS],
          [DekaMarkt] of [Algemeen] blijven de oorspronkelijke winkels behouden.
          Eigen tekstlijstjes met kopjes PLUS:, DekaMarkt: of Algemeen: worden ook per winkel ingelezen.
          Dubbele artikelen worden ook herkend bij compatibele of onzichtbare Unicode-varianten;
          de oorspronkelijke omschrijving blijft zichtbaar. Bestaande vinkjes en prijzen veranderen niet.</p>
        <label>Je ongeprijsde boodschappen
          <textarea rows={5} maxLength={15000} value={bulkDraft}
            placeholder={'Vuilniszakken\nAfwasmiddel\nToiletpapier'}
            onChange={event => { bulkFileSerial.current++; setBulkPreview(null); setBulkDraft(event.target.value) }} />
        </label>
        <label>Of kies een eerder gedownloade eigen Supa-lijst (TXT, maximaal 15 kB)
          <input type="file" accept=".txt,text/plain"
            onChange={event => { void readBulkText(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
        </label>
        <button type="button" onClick={() => downloadOwnCsv('template')}>
          Download leeg CSV-invulblad voor eigen boodschappen
        </button>
        <button type="button" onClick={downloadOwnTsvTemplate}>
          Download leeg Excel/Calc-TSV-invulblad
        </button>
        <label>Importeer eigen ongeprijsde CSV of Excel/Calc-TSV (max. 32 kB; geen retailerprijzen)
          <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={event => {
            void readOwnCsv(event.currentTarget.files?.[0]); event.currentTarget.value = ''
          }} />
        </label>
        <details>
          <summary>Of plak vier kolommen uit Excel/Calc</summary>
          <p>Plak de Supa-CSV, vier tabkolommen uit het eigen invulblad, of gewone
            Excel/Calc-tabkolommen met kopjes <strong>artikel</strong> en <strong>winkel</strong>
            (optioneel <strong>afgevinkt</strong>). De kolomvolgorde mag wisselen;
            winkels zijn exact Algemeen, PLUS of DekaMarkt en vinkjes ja/nee.
            Zonder vinkkolom is alles open. Geen prijs-, SKU- of bronkolommen.
            Bekijk daarna de voorinzage en bevestig zelf.</p>
          <label>Privé-CSV-tekst
            <textarea rows={4} maxLength={32768} value={ownCsvPaste}
              onChange={event => setOwnCsvPaste(event.target.value)}
              placeholder="supa-eigen-ongeprijsd-v1;winkel;artikel;afgevinkt" />
          </label>
          <button type="button" disabled={!ownCsvPaste.trim()} onClick={preparePastedOwnCsv}>
            Zet mijn spreadsheet klaar voor controle
          </button>
        </details>
        <button type="submit" disabled={!bulkDraft.trim() || notes.length >= 100}>
          Bekijk artikelen vóór toevoegen
        </button>
        {bulkPreview && <div className="manual-shopping-notes__bulk-preview" role="group"
          aria-label="Voorbeeld van de ongeprijsde bulkimport">
          <strong>{bulkPreview.incoming.length} nieuwe persoonlijke artikelen</strong>
          <p>{bulkPreview.duplicateCount} dubbele regels overgeslagen.
            Alle winkelprijzen blijven onbekend. Je bestaande vinkjes veranderen niet.</p>
          <ul>{bulkPreview.incoming.slice(0, 15).map((item, index) =>
            <li key={index}>{item.done ? '☑' : '☐'} [{item.store}] {item.label}</li>)}</ul>
          {bulkPreview.incoming.length > 15 && <p>En {bulkPreview.incoming.length - 15} andere.</p>}
          <button type="button" onClick={confirmBulk}>Bevestig toevoegen aan eigen lijst</button>
          <button type="button" onClick={() => setBulkPreview(null)}>Annuleer import</button>
        </div>}

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
      <label>Eerste winkel in mijn route
        <select value={firstShop} onChange={event => setFirstShop(event.currentTarget.value as typeof firstShop)}>
          <option value="PLUS">Eerst PLUS</option>
          <option value="DekaMarkt">Eerst DekaMarkt</option>
        </select>
      </label>
      <label>Zoek mijn eigen boodschappen
        <input type="search" maxLength={120} value={search} placeholder="Zoek zonder accent"
          onChange={event => setSearch(event.target.value)} />
      </label>
      <label><input type="checkbox" checked={onlyOpen} onChange={event => setOnlyOpen(event.target.checked)} /> Alleen open</label>
    </div>
    <div className="manual-shopping-notes__batch" role="group" aria-label="Zichtbare boodschappen beheren">
      <button type="button" disabled={remainingVisible === 0} onClick={() => markVisible(true)}>
        Vink {remainingVisible} zichtbare open boodschappen af
      </button>
      <button type="button" disabled={completedVisible === 0} onClick={() => markVisible(false)}>
        Zet {completedVisible} zichtbare boodschappen weer open
      </button>
      <small>Alleen de huidige winkel- en open-filterselectie. Geen prijzen of bronmomenten wijzigen.</small>
    </div>
    <section className="manual-shopping-notes__finish-trip" aria-label="Afgeronde persoonlijke boodschappen opruimen">
      <strong>Winkelronde afronden</strong>
      <p>Verwijder alleen de zichtbare afgevinkte eigen artikelen als je klaar bent.
        Niet-afgevinkte boodschappen, recepten, Planner en originele supermarktprijzen blijven staan.
        Zet 'Alleen open' eerst uit om gekochte artikelen zichtbaar te maken.</p>
      <button type="button" disabled={completedVisible === 0}
        onClick={() => setPendingCleared(visible.filter(item => item.done))}>
        Ruim {completedVisible} zichtbare gekochte eigen artikelen op…
      </button>
      {pendingCleared && <div role="group" className="manual-shopping-notes__clear-confirm"
        aria-label="Bevestig het opruimen van persoonlijke boodschappen">
        <p>{pendingCleared.length} eigen artikelen verdwijnen uit de actieve lijst;
          dit verandert geen enkele bronprijs en wordt pas uitgevoerd na je bevestiging.</p>
        <p>{pendingCleared.slice(0, 5).map(item => item.label).join(' · ')}
          {pendingCleared.length > 5 ? ' · en ' + (pendingCleared.length - 5) + ' andere' : ''}</p>
        <button type="button" onClick={confirmClearCompleted}>Ja, ruim deze afgeronde items op</button>
        <button type="button" onClick={() => setPendingCleared(null)}>Annuleer</button>
      </div>}
      {lastCleared && <button type="button" onClick={undoCleared}>
        Herstel laatste {lastCleared.length} opgeruimde artikelen
      </button>}
    </section>
    <section className="manual-shopping-notes__next-round" aria-label="Herhaal je eigen winkelronde">
      <strong>Een nieuwe winkelronde met mijn vaste artikelen</strong>
      <p>Heropen alle eigen boodschappen, ook buiten de huidige zoek- of winkelfilter.
        Je oorspronkelijke winkelgroepen, volgorde, recepten, Planner en bronprijzen blijven ongewijzigd.</p>
      <button type="button" disabled={!notes.some(item => item.done)}
        onClick={() => { setPendingNextRound([...notes]); setLastNextRound(null) }}>
        Bereid nieuwe ronde met {notes.length} artikelen voor
      </button>
      {pendingNextRound && <div className="manual-shopping-notes__next-round-confirm" role="group"
        aria-label="Nieuwe persoonlijke winkelronde bevestigen">
        <p>{pendingNextRound.filter(item => item.done).length} gekochte artikelen worden
          weer opengezet; de andere blijven open.</p>
        <button type="button" onClick={confirmNextRound}>Ja, begin de nieuwe ronde</button>
        <button type="button" onClick={() => setPendingNextRound(null)}>Annuleer</button>
      </div>}
      {lastNextRound && <button type="button" onClick={undoNextRound}>Herstel oude vinkjes</button>}
    </section>
    {duplicateOpenLabels.length > 0 && <section className="manual-shopping-notes__double-buy"
      role="status" aria-label="Mogelijk dubbel kopen bij twee winkels">
      <strong>{duplicateOpenLabels.length} {duplicateOpenLabels.length === 1
        ? 'eigen boodschap staat' : 'eigen boodschappen staan'} nog open bij PLUS én DekaMarkt</strong>
      <p>Controleer of je deze persoonlijke artikelen écht bij beide winkels wilt kopen.
        Er zijn geen prijzen of automatische productmatches gebruikt. Kies per artikel
        of houd na controle alle dubbele open regels bij één winkel.</p>
      <div role="group" aria-label="Alle dubbele eigen winkelregels afhandelen">
        <button type="button" onClick={() => prepareDuplicateBatch('PLUS')}>
          Houd {duplicateOpenLabels.length} dubbelen alleen bij PLUS…
        </button>
        <button type="button" onClick={() => prepareDuplicateBatch('DekaMarkt')}>
          Houd {duplicateOpenLabels.length} dubbelen alleen bij DekaMarkt…
        </button>
      </div>
      {pendingDuplicateBatch && <div role="group" aria-label="Bevestig eigen dubbelen per winkel">
        <p>Let op: {pendingDuplicateBatch.pairs.length} dubbele, nog open persoonlijke
          artikelen blijven alleen bij {pendingDuplicateBatch.keep}. De andere regels
          worden verwijderd, zonder prijs-, SKU- of bronwijziging. Je kunt deze actie herstellen.</p>
        <ul>{pendingDuplicateBatch.pairs.slice(0, 8).map(pair =>
          <li key={pair.plus.id}>{pair.plus.label}</li>)}</ul>
        {pendingDuplicateBatch.pairs.length > 8 && <small>
          En {pendingDuplicateBatch.pairs.length - 8} andere.
        </small>}
        <button type="button" onClick={confirmDuplicateBatch}>
          Ja, verwijder {pendingDuplicateBatch.pairs.length} dubbele regels
        </button>
        <button type="button" onClick={() => setPendingDuplicateBatch(null)}>Annuleer</button>
      </div>}
      <ul>{duplicateOpenLabels.slice(0, 8).map(label => <li key={label}>
        <span>{label} · prijs onbekend</span>{' '}
        <button type="button" onClick={() => {
          setFilterStore('Alle winkels'); setOnlyOpen(false); setSearch(label)
        }}>Bekijk bij beide winkels</button>{' '}
        <button type="button" onClick={() => proposeDuplicateChoice(label, 'PLUS')}>
          Alleen op PLUS-lijst…
        </button>{' '}
        <button type="button" onClick={() => proposeDuplicateChoice(label, 'DekaMarkt')}>
          Alleen op DekaMarkt-lijst…
        </button>
      </li>)}</ul>
      {pendingDuplicateChoice && <div role="group"
        aria-label="Bevestig verwijderen van dubbele ongeprijsde boodschap">
        <p>Wil je ‘{pendingDuplicateChoice.plus.label}’ alleen bij
          {' '}{pendingDuplicateChoice.keep} laten staan? De andere persoonlijke regel
          verdwijnt uit je ongeprijsde lijst. Er worden geen originele geprijsde
          producten, winkelbronnen of prijscijfers veranderd.</p>
        <button type="button" onClick={confirmDuplicateChoice}>
          Ja, bewaar alleen {pendingDuplicateChoice.keep}
        </button>
        <button type="button" onClick={() => setPendingDuplicateChoice(null)}>Annuleer</button>
      </div>}
      {duplicateOpenLabels.length > 8 && <small>En {duplicateOpenLabels.length - 8} andere; bekijk
        alle winkels met je eigen zoekfilter.</small>}
    </section>}
    {redundantGeneralNotes.length > 0 && <section className="manual-shopping-notes__double-buy"
      aria-label="Algemene boodschappen die ook op winkellijsten staan">
      <strong>{redundantGeneralNotes.length} open algemene boodschappen staan ook op een winkellijst</strong>
      <p>Dezelfde eigen omschrijving staat bij Algemeen én PLUS of DekaMarkt.
        Dit is alleen een mogelijke dubbele herinnering, geen automatische productmatching
        of prijsvergelijking. Je kunt de algemene regels na controle in één keer verwijderen;
        de echte winkellijst blijft bestaan.</p>
      <button type="button" onClick={() =>
        setPendingGeneralDuplicates(redundantGeneralNotes.map(item => ({ ...item })))}>
        Bekijk {redundantGeneralNotes.length} dubbele algemene regels…
      </button>
      {pendingGeneralDuplicates && <div role="group" aria-label="Dubbele algemene regels bevestigen">
        <p>{pendingGeneralDuplicates.length} nog open algemene regels worden verwijderd;
          dezelfde eigen namen blijven op PLUS of DekaMarkt staan. Geen winkelprijzen,
          SKU's, bronbestanden of bestaande vinkjes worden aangepast.</p>
        <ul>{pendingGeneralDuplicates.slice(0, 12).map(item =>
          <li key={item.id}>{item.label}</li>)}</ul>
        {pendingGeneralDuplicates.length > 12 &&
          <small>En {pendingGeneralDuplicates.length - 12} andere.</small>}
        <button type="button" onClick={confirmGeneralDuplicates}>
          Ja, verwijder alleen de dubbele algemene regels
        </button>
        <button type="button" onClick={() => setPendingGeneralDuplicates(null)}>
          Annuleer
        </button>
      </div>}
    </section>}
    {lastGeneralDuplicates && <p className="manual-shopping-notes__undo-duplicates">
      <button type="button" onClick={undoGeneralDuplicates}>
        Herstel {lastGeneralDuplicates.length} eerder verwijderde algemene boodschappen
      </button>
    </p>}
    {lastDuplicateBatch && <p className="manual-shopping-notes__undo-duplicates">
      <button type="button" onClick={undoDuplicateBatch}>
        Herstel {lastDuplicateBatch.length} eerder verwijderde dubbele eigen boodschappen
      </button>
    </p>}
    <nav className="manual-shopping-notes__trip-nav" aria-label="Mijn persoonlijke winkelroute">
      <strong>Winkelroute · alleen mijn eigen ongeprijsde artikelen</strong>
      <div className="manual-shopping-notes__trip-nav-stores">
        {grouped.map(group => <button type="button" key={group.store}
          onClick={() => goToStore(group.store)}>
          {group.store} · {group.items.filter(item => !item.done).length} open / {group.items.length}
        </button>)}
      </div>
      <button type="button" disabled={!nextOpenStore} onClick={() => {
        if (nextOpenStore) goToStore(nextOpenStore)
      }}>
        {nextOpenStore ? 'Ga naar eerstvolgende open winkel: ' + nextOpenStore : 'Alle zichtbare boodschappen klaar'}
      </button>
    </nav>
    <p className="manual-shopping-notes__order-hint">Orden je eigen artikelen binnen een winkel met ↑ en ↓. Zet zoeken en 'Alleen open' uit om de hele volgorde te bewerken; kopie, TXT en print nemen jouw volgorde over. Selecteer losse regels om alleen die naar een andere winkel te verplaatsen.</p>
    {selectedMoveIds.length > 0 && <p role="status" aria-live="polite">
      {selectedMoveIds.length} artikelen geselecteerd voor een mogelijke winkelwissel.
      <button type="button" disabled={!selectedVisible.length}
        onClick={() => void shareSelectedPersonalNotes()}>
        Deel zichtbare selectie (mobiel)
      </button>
      <button type="button" disabled={!selectedVisible.length} onClick={downloadSelected}>
        Download zichtbare selectie als TXT
      </button>
      <button type="button" onClick={() => setSelectedMoveIds([])}>Wis mijn selectie</button>
    </p>}
    {lastGroupMove && <div className="manual-shopping-notes__undo-move">
      <span>{lastGroupMove.items.length} eigen artikelen verplaatst: {lastGroupMove.from} → {lastGroupMove.to}.</span>
      <button type="button" onClick={undoGroupMove}>Herstel laatste groepsverplaatsing</button>
    </div>}
    <div className="manual-shopping-notes__groups" aria-label="Boodschappen per winkel">
      {grouped.map(group => <section className="manual-shopping-notes__group" key={group.store}
        id={'supa-own-trip-' + group.store} tabIndex={-1}
        aria-label={'Eigen ongeprijsde boodschappen bij ' + group.store}>
        <header className="manual-shopping-notes__group-heading">
          <h3>{group.store}</h3>
          <span>{group.items.filter(item => !item.done).length} open · {group.items.length} zichtbaar</span>
          <div className="manual-shopping-notes__group-actions">
            <button type="button" disabled={!group.items.some(item => !item.done)}
              onClick={() => markGroup(group.store, true)}>Vink deze winkel af</button>
            <button type="button" disabled={!group.items.some(item => item.done)}
              onClick={() => markGroup(group.store, false)}>Heropen deze winkel</button>
            <button type="button" disabled={group.items.every(item => selectedMoveIds.includes(item.id))}
              onClick={() => setSelectedMoveIds(current => Array.from(new Set([
                ...current, ...group.items.map(item => item.id),
              ])))}>
              Selecteer zichtbare {group.store}-artikelen
            </button>
            <button type="button" disabled={!group.items.some(item => selectedMoveIds.includes(item.id))}
              onClick={() => {
                const groupIds = new Set(group.items.map(item => item.id))
                setSelectedMoveIds(current => current.filter(id => !groupIds.has(id)))
              }}>
              Wis {group.store}-selectie
            </button>
          </div>
          <div className="manual-shopping-notes__assign">
            <label>Verplaats mijn zichtbare {group.store}-artikelen naar
              <select value={moveTargets[group.store]} onChange={event => {
                const target = event.currentTarget.value as UnpricedShoppingNote['store']
                setMoveTargets(current => ({ ...current, [group.store]: target }))
              }}>
                {stores.filter(target => target !== group.store).map(target =>
                  <option key={target} value={target}>{target}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => moveVisibleOwnNotes(group.store)}>
              Verplaats {group.items.length} zichtbare artikelen
            </button>
            <button type="button" disabled={!group.items.some(item => selectedMoveIds.includes(item.id))}
              onClick={() => moveVisibleOwnNotes(group.store, true)}>
              Verplaats {group.items.filter(item => selectedMoveIds.includes(item.id)).length} geselecteerde artikelen
            </button>
            <small>Alleen jouw eigen ongeprijsde lijst: bestaande dubbelen blokkeren verplaatsing;
              de afvinkingen en brongegevens blijven behouden.</small>
          </div>
        </header>
        <ul>{group.items.map(note => <li key={note.id}>
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
        <label><input type="checkbox" checked={selectedMoveIds.includes(note.id)}
          aria-label={`Selecteer ${note.label} bij ${note.store} voor winkelwissel`}
          onChange={event => {
            const checked = event.currentTarget.checked
            setSelectedMoveIds(current => checked
              ? current.includes(note.id) ? current : [...current, note.id]
              : current.filter(id => id !== note.id))
          }} /> Kies voor winkelwissel</label>
        <label><input type="checkbox" checked={note.done}
          onChange={() => setNotes(current => current.map(item => item.id === note.id
            ? { ...item, done: !item.done } : item))} />
          <span>{note.label} <small>· {note.store} · prijs onbekend</small></span></label>
        <div className="manual-shopping-notes__ordering" role="group"
          aria-label={`Volgorde van ${note.label} bij ${group.store}`}>
          <button type="button" aria-label={`Zet ${note.label} hoger bij ${group.store}`}
            title="Eerder in deze winkel"
            disabled={onlyOpen || !!needle || group.items[0]?.id === note.id}
            onClick={() => moveOwnNoteWithinStore(note.id, -1)}>↑</button>
          <button type="button" aria-label={`Zet ${note.label} lager bij ${group.store}`}
            title="Later in deze winkel"
            disabled={onlyOpen || !!needle || group.items.at(-1)?.id === note.id}
            onClick={() => moveOwnNoteWithinStore(note.id, 1)}>↓</button>
        </div>
        <button type="button" onClick={() => setEditing({ id: note.id,
          initialLabel: note.label, initialStore: note.store, label: note.label, store: note.store })}
          aria-label={`Bewerk ${note.label}`}>Bewerk</button>
        <button type="button" onClick={() => removeOwnNote(note.id)}
          aria-label={`Verwijder ${note.label}`}>Verwijder</button>
      </>}
        </li>)}</ul>
      </section>)}
    </div>
    {!visible.length && <p role="status">
      {needle ? 'Geen eigen boodschappen gevonden voor deze zoekopdracht.' :
        selected.length ? 'Alle boodschappen in deze selectie zijn afgevinkt.' :
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
      {sessionProtected && <div className="manual-shopping-notes__recovery" role="group"
        aria-label="Beschermde tabkopie controleren">
        <button type="button" onClick={() => previewSavedCopy('tab')}>Bekijk tabkopie om samen te voegen</button>
        <button type="button" onClick={() => discardProtectedCopy('tab')}>Wis alleen oude tabkopie…</button>
      </div>}
      <label><input type="checkbox" checked={deviceEnabled} disabled={deviceProtected}
        onChange={event => changeDeviceOptIn(event.target.checked)} />
        Bewaar mijn ongeprijsde boodschappen op dit apparaat (ook na sluiten)</label>
      <small>Alleen na jouw keuze. Versleuteling is afhankelijk van dit apparaat en
        browserprofiel; anderen met toegang tot dit profiel kunnen de lijst zien.
        Geen account, cloud, retailerprijzen, automatische synchronisatie of server.
        Uitschakelen verwijdert de apparaatkopie, niet je geopende lijst.
        Bewaar een eigen JSON-backup voordat je de browsergegevens wist.</small>
      {deviceMessage && <p role="status" aria-live="polite">{deviceMessage}</p>}
      {deviceProtected && <div className="manual-shopping-notes__recovery" role="group"
        aria-label="Beschermde apparaatkopie controleren">
        <button type="button" onClick={() => previewSavedCopy('device')}>Bekijk apparaatkopie om samen te voegen</button>
        <button type="button" onClick={() => discardProtectedCopy('device')}>Wis alleen oude apparaatkopie…</button>
      </div>}
    </section>
    <section className="manual-shopping-notes__session" aria-label="Herbruikbare eigen boodschappenronde">
      <h3>Mijn vaste boodschappen · herhaalronde</h3>
      <p>Bewaar zelfgekozen artikelen voor een volgende winkelronde. Alleen de namen
        en jouw winkellijst worden na toestemming lokaal op dit apparaat opgeslagen;
        vinkjes worden bij het opnieuw toevoegen weer open, prijzen en bronopnames
        worden nooit meegesleept. Er is één vervangbaar privé-sjabloon.</p>
      <label>Naam van mijn herhaalronde
        <input maxLength={60} value={repeatName} disabled={repeatProtected}
          onChange={event => setRepeatName(event.currentTarget.value)} />
      </label>
      <button type="button" disabled={repeatProtected || !selectedVisible.length}
        onClick={saveRepeatTemplate}>
        Bewaar {selectedVisible.length} geselecteerde zichtbare artikelen als herhaalronde…
      </button>
      <button type="button" disabled={repeatProtected || repeatRaw === null}
        onClick={prepareRepeatTemplate}>Bekijk mijn bewaarde herhaalronde</button>
      <button type="button" disabled={!selectedVisible.length}
        onClick={downloadSelectedRepeatTemplate}>
        Download selectie als herhaalronde (JSON, zonder apparaatopslag)
      </button>
      <button type="button" disabled={repeatProtected || repeatRaw === null}
        onClick={downloadRepeatTemplate}>Download mijn herhaalronde (JSON)</button>
      <label>Importeer herhaalronde vanaf een ander apparaat (JSON, max. 32 kB)
        <input type="file" accept=".json,application/json"
          onChange={event => {
            void readRepeatTemplateFile(event.currentTarget.files?.[0])
            event.currentTarget.value = ''
          }} />
      </label>
      <button type="button" onClick={deleteRepeatTemplate}
        disabled={repeatRaw === null && !repeatProtected}>
        {repeatProtected ? 'Wis beschermd sjabloon na bevestiging…' : 'Verwijder mijn bewaarde herhaalronde…'}
      </button>
      {repeatFilePreview && <div role="group" aria-label="Privé-sjabloonimport controleren">
        <strong>Importbestand: {repeatFilePreview.name}</strong>
        <p>{repeatFilePreview.items.length} persoonlijke ongeprijsde artikelen. Dit bestand bevat geen
          afvinkingen, SKU's of bronprijzen. Alleen het lokale herhaalsjabloon wordt vervangen,
          niet de huidige boodschappenlijst. Herhalen vraagt daarna apart om bevestiging.</p>
        <ul>{repeatFilePreview.items.slice(0, 15).map((item, index) =>
          <li key={index}>☐ [{item.store}] {item.label}</li>)}</ul>
        {repeatFilePreview.items.length > 15 &&
          <p>En {repeatFilePreview.items.length - 15} andere artikelen; download en inspecteer
            het JSON-bestand als je deze volledige lijst wilt controleren.</p>}
        <button type="button" onClick={confirmRepeatTemplateFile}>Bewaar dit sjabloon op mijn apparaat</button>
        <button type="button" onClick={() => setRepeatFilePreview(null)}>Annuleer bestandimport</button>
      </div>}
      {repeatPreview && <div role="group" aria-label="Voorinzage van persoonlijke herhaalronde">
        <strong>{repeatPreview.name} · {repeatPreview.additions.length} nieuwe artikelen</strong>
        <p>{repeatPreview.skipped} bestaande artikelen overgeslagen. Kies welke van de
          {repeatPreview.additions.length} nieuwe artikelen je deze ronde wilt kopen.
          Vinkjes starten open en tellen nooit mee als winkelprijs.</p>
        <p role="status">{repeatPreview.selectedIndices.length} gekozen; maximaal {Math.max(0, 100 - notes.length)}
          extra artikelen passen nog op je persoonlijke lijst.
          {repeatPreview.selectedIndices.length > 100 - notes.length &&
            ' Kies een kleinere selectie om toe te voegen; downloaden en delen kan altijd zonder lijstwijziging.'}</p>
        <button type="button" onClick={() => setRepeatPreview(current => current ? {
          ...current, selectedIndices: current.additions
            .slice(0, Math.max(0, 100 - notes.length)).map((_, index) => index),
        } : current)}>Kies eerste artikelen tot mijn lijst vol is</button>
        <button type="button" onClick={() => setRepeatPreview(current => current ? {
          ...current, selectedIndices: [],
        } : current)}>Wis mijn selectie</button>
        <div className="manual-shopping-notes__repeat-shops" role="group" aria-label="Selecteer één winkel uit herhaalronde">
          {stores.map(shop => <button key={shop} type="button"
            onClick={() => selectRepeatTemplateStore(shop)}>
            Alleen {shop} ({repeatPreview.additions.filter(item => item.store === shop).length})
          </button>)}
        </div>
        <ul className="manual-shopping-notes__repeat-items" aria-label="Kies artikelen voor herhaalronde">{repeatPreview.additions.map((item, index) =>
          <li key={index}><label><input type="checkbox"
            checked={repeatPreview.selectedIndices.includes(index)}
            onChange={event => {
              const checked = event.currentTarget.checked
              setRepeatPreview(current => {
                if (!current) return current
                const selected = new Set(current.selectedIndices)
                if (checked) selected.add(index)
                else selected.delete(index)
                return { ...current, selectedIndices: [...selected].sort((a, b) => a - b) }
              })
            }} /> [{item.store}] {item.label}</label></li>)}</ul>
        <button type="button" disabled={!repeatPreview.selectedIndices.length ||
          repeatPreview.selectedIndices.length > 100 - notes.length}
          onClick={confirmRepeatTemplate}>
          Voeg {repeatPreview.selectedIndices.length} gekozen artikelen toe
        </button>
        <div className="manual-shopping-notes__repeat-shops" role="group"
          aria-label="Geselecteerde privé-herhaalronde zonder toevoegen meenemen">
          <button type="button" disabled={!repeatPreview.selectedIndices.length}
            onClick={downloadSelectedRepeatRoundText}>
            Download gekozen herhaalartikelen (TXT)
          </button>
          <button type="button" disabled={!repeatPreview.selectedIndices.length}
            onClick={downloadSelectedRepeatRoundPrint}>
            Download afdrukbaar winkelblad (HTML, per winkel)
          </button>
          <button type="button" disabled={!repeatPreview.selectedIndices.length}
            onClick={() => void shareSelectedRepeatRoundText()}>
            Deel gekozen herhaalartikelen (mobiel)
          </button>
        </div>
        <button type="button" onClick={() => setRepeatPreview(null)}>Annuleer herhaalronde</button>
      </div>}
      {repeatMessage && <p role="status" aria-live="polite">{repeatMessage}</p>}
    </section>
    <div className="manual-shopping-notes__actions">
      <button type="button" disabled={!visible.length} onClick={() => setExportVisible(value => !value)}>
        {exportVisible ? 'Verberg kopieertekst' : 'Toon kopieertekst'}</button>
      <button type="button" disabled={!visible.length} onClick={download}>Download lijst (TXT)</button>
      <button type="button" disabled={!visible.length} onClick={() => void copyPersonalShoppingList()}>
        Kopieer zichtbare lijst
      </button>
      <button type="button" disabled={!visible.length} onClick={() => void sharePersonalShoppingList()}>
        Deel zichtbare lijst (mobiel)
      </button>
      <button type="button" disabled={!visible.length} onClick={downloadPrintableList}>
        Offline afdrukbare lijst (HTML)
      </button>
      <button type="button" disabled={!visible.length} onClick={() => downloadOwnCsv('visible')}>
        Zichtbare winkelronde (CSV voor Excel)
      </button>
      <button type="button" disabled={!notes.length} onClick={() => downloadOwnCsv('all')}>
        Hele eigen ongeprijsde lijst (CSV voor Excel)
      </button>
      <button type="button" disabled={!notes.length} onClick={() => void copyOwnSpreadsheet()}>
        Kopieer alle boodschappen als Excel-tabel (4 kolommen)
      </button>
      <button type="button" disabled={!visible.length} onClick={() => downloadOwnTsv('visible')}>
        Zichtbare winkelronde (TSV voor Excel/Calc)
      </button>
      <button type="button" disabled={!notes.length} onClick={() => downloadOwnTsv('all')}>
        Hele eigen ongeprijsde lijst (TSV voor Excel/Calc)
      </button>
      <button type="button" disabled={!notes.length} onClick={backupDownload}>Backup hele lijst (JSON)</button>
      <label>Herstel lijst uit JSON-backup (max. 64 kB)
        <input type="file" accept=".json,application/json" disabled={backupBusy}
          onChange={event => { void backupRead(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      </label>
    </div>
    {backupPreview && <div className="manual-shopping-notes__backup" role="group"
      aria-label="Voorbeeld van de boodschappenbackup">
      <strong>Privébackup: {backupPreview.incoming.length} artikelen, waarvan {backupPreview.additions.length} nieuw</strong>
      <p>{backupPreview.duplicateCount} bestaande of dubbele artikelen overgeslagen. De voorinzage is alleen geldig zolang jouw lijst onveranderd blijft.</p>
      {backupPreview.additions.length > 0 && <ul>
        {backupPreview.additions.slice(0, 15).map(item => <li key={item.id}>
          {item.done ? '☑' : '☐'} [{item.store}] {item.label}
        </li>)}
        {backupPreview.additions.length > 15 &&
          <li>En {backupPreview.additions.length - 15} andere nieuwe boodschappen.</li>}
      </ul>}

      <p>Bestaande artikelen en vinkjes worden niet overschreven. Dubbelen met een ander ID
        maar dezelfde winkel en omschrijving worden overgeslagen. Conflicterende IDs en meer
        dan 100 artikelen worden geweigerd. Niets wordt geüpload of geprijsd.</p>
      <button type="button" disabled={!backupPreview.additions.length} onClick={backupConfirm}>Bevestig {backupPreview.additions.length} nieuwe boodschappen</button>
      <button type="button" onClick={() => { readVersion.current++; setBackupPreview(null) }}>
        Annuleer import
      </button>
    </div>}
    {lastImport && lastImport.added.length > 0 &&
      <button type="button" className="ghost-button" onClick={undoLastImport}>
        Herstel laatste import uit {lastImport.source} ({lastImport.added.length} eigen artikelen)
      </button>}
    {spreadsheetFallback && <label>Vierkoloms Supa-tabel om handmatig te kopiëren
      <textarea readOnly spellCheck={false} rows={7} value={spreadsheetFallback}
        onFocus={event => event.currentTarget.select()} />
      <small>Persoonlijke, ongeprijsde lijst op het moment van kopiëren; geen actuele winkelsnapshot.</small>
    </label>}
    {exportVisible && visible.length > 0 && <label>Kopieer mijn ongeprijsde boodschappen
      <textarea rows={Math.min(selected.length + 6, 15)} readOnly value={exportText}
        onFocus={event => event.currentTarget.select()} /></label>}
    <p role="status" aria-live="polite">{message}</p>
  </section>
}
