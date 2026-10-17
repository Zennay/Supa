import { useEffect, useMemo, useState } from 'react'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { historicalRetailerProducts } from '../products/historicalRetailerProducts.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

type Unit = 'g' | 'kg' | 'ml' | 'l' | 'piece'
type ProductDraft = {
  name: string
  packAmount: string
  packUnit: Unit
  packCount: string
  priceEuros: string
  available: boolean
}
const stores: OfflineRetailer[] = ['PLUS', 'DekaMarkt']
const supportedUnits: Unit[] = ['g', 'kg', 'ml', 'l', 'piece']
const emptyDraft = (unit: string): ProductDraft => ({
  name: '', packAmount: '', packUnit: supportedUnits.includes(unit as Unit) ? unit as Unit : 'g',
  packCount: '1', priceEuros: '', available: false,
})
const key = (store: OfflineRetailer, ingredientId: string) => JSON.stringify([store, ingredientId])

/** Convert a *user-entered* local civil time into an explicit physical offset. */
function timestampWithOffset(value: string): string | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const check = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (check !== value) return null
  const minutes = -date.getTimezoneOffset()
  const offset = `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`
  return `${value}:00${offset}`
}
function amountOrNull(raw: string): number | null {
  if (!/^\d{1,6}(?:[.,]\d{1,4})?$/.test(raw)) return null
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) && value > 0 && value <= 100000 ? value : null
}
function eurosToCents(raw: string): number | null {
  if (!/^\d{1,5}(?:[.,]\d{1,2})?$/.test(raw)) return null
  const [whole, decimal = ''] = raw.replace(',', '.').split('.')
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1000000 ? cents : null
}

const privateDraftStorageKey = 'supa:local-two-store-price-draft:v1'

type StoredDraft = {
  saved: boolean
  rows: Record<string, ProductDraft>
  capturedAt: Record<OfflineRetailer, string>
  raw: string | null
  protected: boolean
}
function readPrivateDraft(fingerprint: string): StoredDraft {
  const empty: StoredDraft = { saved: false, rows: {}, capturedAt: { PLUS: '', DekaMarkt: '' }, raw: null, protected: false }
  if (typeof window === 'undefined') return empty
  let raw: string | null
  try { raw = window.sessionStorage.getItem(privateDraftStorageKey) }
  catch { return { ...empty, protected: true } }
  if (raw === null) return empty
  if (raw.length > 256000) return { ...empty, raw, protected: true }
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('shape')
    const r = value as Record<string, unknown>
    if (r.schemaVersion !== 1 || typeof r.fingerprint !== 'string' ||
        Object.keys(r).some(k => !['schemaVersion', 'fingerprint', 'rows', 'capturedAt'].includes(k)) ||
        !r.rows || typeof r.rows !== 'object' || Array.isArray(r.rows) ||
        !r.capturedAt || typeof r.capturedAt !== 'object' || Array.isArray(r.capturedAt)) throw Error('shape')
    if (r.fingerprint !== fingerprint) return { ...empty, raw, protected: true }
    const dates = r.capturedAt as Record<string, unknown>
    if (Object.keys(dates).some(k => !['PLUS', 'DekaMarkt'].includes(k)) ||
        typeof dates.PLUS !== 'string' || dates.PLUS.length > 16 ||
        typeof dates.DekaMarkt !== 'string' || dates.DekaMarkt.length > 16) throw Error('times')
    const rows = r.rows as Record<string, unknown>
    if (Object.keys(rows).length > 2000 || !Object.entries(rows).every(([k, rawRow]) => {
      if (k.length > 500 || !Array.isArray(JSON.parse(k)) ||
          !rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return false
      const row = rawRow as Record<string, unknown>
      return Object.keys(row).every(field => ['name', 'packAmount', 'packUnit', 'packCount', 'priceEuros', 'available'].includes(field)) &&
        typeof row.name === 'string' && row.name.length <= 160 &&
        typeof row.packAmount === 'string' && row.packAmount.length <= 24 &&
        typeof row.packUnit === 'string' && supportedUnits.includes(row.packUnit as Unit) &&
        typeof row.packCount === 'string' && row.packCount.length <= 8 &&
        typeof row.priceEuros === 'string' && row.priceEuros.length <= 24 &&
        typeof row.available === 'boolean'
    })) throw Error('rows')
    return { saved: true, rows: rows as Record<string, ProductDraft>,
      capturedAt: { PLUS: dates.PLUS, DekaMarkt: dates.DekaMarkt }, raw, protected: false }
  } catch {
    return { ...empty, raw, protected: true }
  }
}

type Props = {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  onGenerated: (json: string) => void
  onEdit: () => void
}
/**
 * UI-only source authoring: a real user's *own* entry, never an auto-captured
 * licensed catalog, attestation, retailer permission, or independent evidence.
 */
export function LocalTwoStorePriceEditor({ plan, recipes, activeDays, onGenerated, onEdit }: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Record<string, ProductDraft>>({})
  const [capturedAt, setCapturedAt] = useState<Record<OfflineRetailer, string>>({ PLUS: '', DekaMarkt: '' })
  const [error, setError] = useState('')
  const [output, setOutput] = useState('')
  const needs = useMemo(() => {
    try { return aggregatePlanIngredients(plan, recipes, activeDays) }
    catch { return [] }
  }, [plan, recipes, activeDays])
  const activeNeeds = needs.filter(item => item.label.trim() && item.query.trim())
  const selectedPlanFingerprint = JSON.stringify([plan, activeDays, needs.map(item => [item.id, item.amount, item.unit])])
  const [preparedFor, setPreparedFor] = useState('')
  const [savedDraftRaw, setSavedDraftRaw] = useState<string | null>(null)
  const [draftOptIn, setDraftOptIn] = useState(false)
  const [draftFingerprint, setDraftFingerprint] = useState('')
  const [draftProtected, setDraftProtected] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')

  // Explicitly opt-in to *session-only* recovery. A different planner or
  // unknown/future record can never silently be reinterpreted or replaced.
  useEffect(() => {
    const old = readPrivateDraft(selectedPlanFingerprint)
    setRows(old.rows)
    setCapturedAt(old.capturedAt)
    setDraftOptIn(old.saved)
    setDraftFingerprint(selectedPlanFingerprint)
    setDraftProtected(old.protected)
    setSavedDraftRaw(old.raw)
    if (old.saved) setDraftStatus('Je vorige privéconcept voor deze week is hersteld in deze browsertab.')
    else if (old.protected) setDraftStatus('Een eerder concept voor een andere week of versie is beschermd tegen overschrijven.')
    else setDraftStatus('')
  }, [selectedPlanFingerprint])

  useEffect(() => {
    if (!draftOptIn || draftProtected || draftFingerprint !== selectedPlanFingerprint ||
        typeof window === 'undefined') return
    try {
      const actual = window.sessionStorage.getItem(privateDraftStorageKey)
      if (actual !== savedDraftRaw) {
        setDraftProtected(true)
        setDraftStatus('Een ander of onbekend concept is bewaard; SUPA overschrijft dit niet.')
        return
      }
      const next = JSON.stringify({ schemaVersion: 1, fingerprint: selectedPlanFingerprint, rows, capturedAt })
      if (new TextEncoder().encode(next).length > 256000) throw Error('oversized')
      if (next !== actual) window.sessionStorage.setItem(privateDraftStorageKey, next)
      setSavedDraftRaw(next)
      setDraftStatus('Dit concept blijft alleen in deze browsertab bewaard tot je het wist of de tab sluit.')
    } catch {
      setDraftOptIn(false)
      setDraftStatus('Kon dit privéconcept niet bewaren. Gebruik desgewenst de lokale JSON-download.')
    }
  }, [draftOptIn, draftProtected, draftFingerprint, rows, capturedAt, selectedPlanFingerprint])

  function clearDraft() {
    if (typeof window !== 'undefined') {
      try {
        const actual = window.sessionStorage.getItem(privateDraftStorageKey)
        if (!draftProtected && actual === savedDraftRaw) window.sessionStorage.removeItem(privateDraftStorageKey)
      } catch { /* keep protected bytes */ }
    }
    setDraftOptIn(false)
    setDraftStatus('Concept niet langer automatisch bewaard in deze browsertab.')
    setSavedDraftRaw(null)
  }

  function changeRow(store: OfflineRetailer, id: string, patch: Partial<ProductDraft>, unit: string) {
    const idKey = key(store, id)
    setRows(prev => ({ ...prev, [idKey]: { ...(prev[idKey] ?? emptyDraft(unit)), ...patch } }))
    setOutput(''); setError(''); setPreparedFor(''); onEdit()
  }
  function changeTimestamp(store: OfflineRetailer, value: string) {
    setCapturedAt(prev => ({ ...prev, [store]: value }))
    setOutput(''); setError(''); setPreparedFor(''); onEdit()
  }
  function createSourceFile() {
    setError(''); setOutput('')
    try {
      if (!activeNeeds.length || activeNeeds.length > 1000) {
        throw new Error('Kies eerst een weekmenu met ondersteunde ingrediënten (maximaal 1.000).')
      }
      const times = stores.map(store => timestampWithOffset(capturedAt[store]))
      if (times.some(time => time === null)) {
        throw new Error('Vul voor beide winkels de echte, lokaal genoteerde datum en tijd in.')
      }
      if (times.some(time => Date.parse(time!) > Date.now() + 300000)) {
        throw new Error('Een waarnemingstijd ligt in de toekomst.')
      }
      const captures = stores.map((store, storeIndex) => {
        const products = activeNeeds.flatMap((need, index) => {
          const draft = rows[key(store, need.id)] ?? emptyDraft(need.unit)
          const entered = draft.name.trim() || draft.packAmount.trim() ||
            draft.priceEuros.trim() || draft.available
          if (!entered) return []
          if (draft.name !== draft.name.trim() || !draft.name.trim()) {
            throw new Error(`${store} · ${need.label}: vul een werkelijke, complete productnaam in.`)
          }
          const packAmount = draft.packAmount ? amountOrNull(draft.packAmount.trim()) : null
          if (draft.packAmount && packAmount === null) {
            throw new Error(`${store} · ${need.label}: ongeldige fysieke verpakking.`)
          }
          const count = Number(draft.packCount)
          if (!/^\d{1,4}$/.test(draft.packCount) || !Number.isSafeInteger(count) || count < 1 || count > 1000) {
            throw new Error(`${store} · ${need.label}: multipack-aantal moet 1–1.000 zijn.`)
          }
          const price = draft.priceEuros ? eurosToCents(draft.priceEuros.trim()) : null
          if (draft.priceEuros && price === null) {
            throw new Error(`${store} · ${need.label}: bedrag moet een positief bedrag in euro's zijn.`)
          }
          if (draft.available && (packAmount === null || price === null)) {
            throw new Error(`${store} · ${need.label}: beschikbaar vereist geobserveerde verpakking en prijs.`)
          }
          if (!draft.available && price !== null) {
            throw new Error(`${store} · ${need.label}: prijs ingevuld maar beschikbaarheid niet bevestigd.`)
          }
          return [{
            id: `own-${store === 'PLUS' ? 'plus' : 'deka'}-${index + 1}`,
            name: draft.name, packAmount, packUnit: draft.packUnit,
            packCount: count, available: draft.available,
            priceCents: draft.available ? price : null,
          }]
        })
        if (products.length === 0) {
          throw new Error(`Vul bij ${store} minimaal één echt product in. Andere ingrediënten mogen onbekend blijven.`)
        }
        return { retailer: store, observedAt: times[storeIndex], products }
      })
      const json = JSON.stringify({ schema: 'supa-offline-prices-v1', captures }, null, 2)
      if (new TextEncoder().encode(json).length > 256000) {
        throw new Error('Je invoer is te groot voor de lokale import van maximaal 256 kB.')
      }
      // The edited source file must pass the exact same admission gate as an
      // uploaded file *before* we offer it as a prepared/exportable snapshot.
      parseOfflinePriceSnapshots(json, Date.now())
      setPreparedFor(selectedPlanFingerprint)
      setOutput(json)
      onGenerated(json)
    } catch (exception) {
      setPreparedFor('')
      setError(exception instanceof Error ? exception.message : 'Kon deze gegevens niet opbouwen.')
    }
  }
  const validOutput = output && selectedPlanFingerprint === preparedFor

  function downloadPreparedSource() {
    if (!validOutput || typeof window === 'undefined') return
    const bytes = new Blob([output], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(bytes)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-prijzen-eigen-invoer.json'
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  return <section className="offline-manual-editor" aria-label="Productprijzen zelf invoeren">
    <div className="offline-manual-editor__header">
      <div><h3>Geen JSON? Vul de winkels hier in</h3>
        <p>Gebruikt automatisch je gekozen weekmaaltijden. Alleen zelf daadwerkelijk geobserveerde producten en bedragen invullen.</p>
      </div>
      <button type="button" className="ghost-button" aria-expanded={open}
        onClick={() => setOpen(value => !value)}>{open ? 'Sluit invoer' : 'Open invulscherm'}</button>
    </div>
    {open && <>
      <p className="disclaimer">Dit is een particuliere invoerhulp. Een zelf ingevulde tijd of prijs is geen onafhankelijk veldbewijs,
        geen bewijs van bronrechten en geen actuele publiceerbare supermarktprijs. Niets wordt naar een server gestuurd.</p>
      {activeNeeds.length === 0 ? <p role="status">Selecteer in Planner minimaal één maaltijd met ingrediënten.</p> : (
        <p role="status">{activeNeeds.length} verschillende ingrediënten uit je huidige weekmenu.
          Lege of onbekende producten blijven niet gekoppeld en krijgen nooit een nulprijs.</p>
      )}
      <div className="offline-manual-editor__draft">
        <label><input type="checkbox" checked={draftOptIn} disabled={draftProtected}
          onChange={e => { setDraftOptIn(e.target.checked); if (!e.target.checked) clearDraft() }} />
          Onvoltooide invoer bewaren in deze browsertab (optioneel, niet naar een server)
        </label>
        <span role="status">{draftStatus}</span>
        {draftOptIn && <button type="button" className="ghost-button" onClick={clearDraft}>
          Stop automatisch bewaren en wis concept
        </button>}
      </div>
      <div className="offline-manual-editor__stores">
        {stores.map(store => <section key={store} aria-label={`Productprijzen bij ${store}`}>
          <h4>{store}</h4>
          <p className="disclaimer">Suggesties voor productnamen komen alleen uit historische, prijsloze bronwaarnemingen
            van 4 oktober 2026. Controleer zelf of het product vandaag echt bestaat; er wordt nooit een
            prijs, verpakking of beschikbaarheid uit dit archief automatisch overgenomen.</p>
          <datalist id={`historical-products-${store}`}>
            {historicalRetailerProducts.filter(item => item.store === store).map(item => (
              <option key={item.id} value={item.name} label={`Historisch: ${item.pack}`} />
            ))}
          </datalist>
          <label className="offline-manual-editor__time">Wanneer zijn deze producten echt waargenomen?
            <input type="datetime-local" value={capturedAt[store]} onChange={e => changeTimestamp(store, e.target.value)} />
          </label>
          {activeNeeds.map(need => {
            const row = rows[key(store, need.id)] ?? emptyDraft(need.unit)
            return <fieldset key={need.id} className="offline-manual-editor__row">
              <legend>{need.label} · benodigd {need.amount ?? '?'} {need.unit}</legend>
              <label>Werkelijke productnaam (laat leeg als onbekend)
                <input value={row.name} maxLength={160} autoComplete="off"
                  list={`historical-products-${store}`}
                  placeholder="Naam op product of bon"
                  onChange={e => changeRow(store, need.id, { name: e.target.value }, need.unit)} />
              </label>
              <div className="offline-manual-editor__quantities">
                <label>Inhoud per verpakking
                  <input type="text" inputMode="decimal" placeholder="Bijv. 500" value={row.packAmount}
                    onChange={e => changeRow(store, need.id, { packAmount: e.target.value }, need.unit)} />
                </label>
                <label>Eenheid
                  <select value={row.packUnit} onChange={e => changeRow(store, need.id, { packUnit: e.target.value as Unit }, need.unit)}>
                    {supportedUnits.map(unit => <option key={unit} value={unit}>{unit === 'piece' ? 'stuk' : unit}</option>)}
                  </select>
                </label>
                <label>Stuks per multipack
                  <input inputMode="numeric" type="number" min="1" max="1000" value={row.packCount}
                    onChange={e => changeRow(store, need.id, { packCount: e.target.value }, need.unit)} />
                </label>
              </div>
              <label>Geobserveerde prijs voor één verpakking (€)
                <input type="text" inputMode="decimal" placeholder="Bijv. 2,49" value={row.priceEuros}
                  onChange={e => changeRow(store, need.id, { priceEuros: e.target.value }, need.unit)} />
              </label>
              <label className="offline-manual-editor__available">
                <input type="checkbox" checked={row.available} onChange={e => changeRow(store, need.id, { available: e.target.checked }, need.unit)} />
                Beschikbaar en prijs zelf gecontroleerd
              </label>
            </fieldset>
          })}
        </section>)}
      </div>
      <div className="offline-price-workbench__actions">
        <button type="button" onClick={createSourceFile}>Bereken met mijn ingevoerde prijzen</button>
        <button type="button" className="ghost-button" onClick={() => {
          setRows({}); setCapturedAt({ PLUS: '', DekaMarkt: '' })
          setOutput(''); setError(''); setPreparedFor(''); onEdit()
        }}>Wis het invulscherm</button>
      </div>
      {error && <p role="alert" className="attention-card">{error}</p>}
      {validOutput && <details className="offline-manual-editor__export">
        <summary>Maak een lokale kopie van jouw prijsinvoer</summary>
        <p>Je gegevens blijven uitsluitend op dit apparaat. Download de JSON zodat je je invoer later opnieuw kunt importeren.</p>
        <button type="button" className="ghost-button" onClick={downloadPreparedSource}>
          Bewaar mijn invoer als JSON
        </button>
        <textarea readOnly rows={6} value={output} aria-label="Zelf ingevoerde prijsdata als JSON"
          onFocus={e => e.currentTarget.select()} />
      </details>}
    </>}
  </section>
}
