import { lazy, Suspense, useRef, useState } from 'react'
import { exportManualOwnSourceDraft, importManualOwnSourceDraft, MANUAL_DRAFT_MAX_BYTES, type ManualEntry, type ManualSources } from './manualOwnSourceDraft.ts'
import type { OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import { readablePlannerDemandAmount, type PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { privatePackUnitRate, formatPrivateUnitRate } from '../comparison/privateUnitPrice.ts'
import './manualOwnSourceEntry.css'
// Reuse the existing device-only camera reader. Camera is opt-in and no
// retailer identifier, offer or price is inferred by the barcode detector.
const LocalDeviceBarcodeScanner = lazy(() =>
  import('../comparison/LocalDeviceBarcodeScanner.tsx')
    .then(module => ({ default: module.LocalDeviceBarcodeScanner })))

type Store = 'PLUS' | 'DekaMarkt'
type Field = 'id' | 'name' | 'packAmount' | 'packUnit' | 'packCount' | 'priceCents' | 'available'
type Entry = ManualEntry
type Source = { observedAt: string; products: Entry[] }

const STORES: readonly Store[] = ['PLUS', 'DekaMarkt']
const FIELDS: readonly Field[] = ['id', 'name', 'packAmount', 'packUnit', 'packCount', 'priceCents', 'available']
const HEADER = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
] as const
const emptyEntry = (): Entry => ({
  id: '', name: '', packAmount: '', packUnit: '', packCount: '',
  priceCents: '', available: '',
})
const initialSource = (): Source => ({ observedAt: '', products: [emptyEntry()] })
function enteredUnitPrice(row: Entry): string | null {
  if (row.available !== 'true' ||
      !/^(?:0|[1-9]\d*)(?:[.,]\d{1,6})?$/.test(row.packAmount) ||
      !/^[1-9]\d*$/.test(row.packCount) ||
      !/^(?:0|[1-9]\d*)$/.test(row.priceCents)) return null
  const amount = Number(row.packAmount.replace(',', '.'))
  const count = Number(row.packCount)
  const priceCents = Number(row.priceCents)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 ||
      !Number.isSafeInteger(count) || count > 1000 ||
      !Number.isSafeInteger(priceCents) || priceCents > 1000000 ||
      (row.packUnit === 'piece' && !Number.isSafeInteger(amount))) return null
  const rate = privatePackUnitRate({ amount, unit: row.packUnit, count, priceCents })
  return rate ? formatPrivateUnitRate(rate) : null
}

const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value

/** UI-only serializer. The existing CSV converter and private source admission
 * still validate every SKU, timestamp, pack, availability and price. */
function serializeManualCapture(sources: Record<Store, Source>): string {
  const rows: string[][] = []
  for (const store of STORES) {
    const source = sources[store]
    const products = source.products.filter(product =>
      FIELDS.some(field => product[field].trim() !== ''))
    if (source.observedAt.trim() && products.length === 0)
      throw new Error(store + ': voeg ten minste één echt geobserveerd product toe.')
    if (products.length === 0) continue
    if (!source.observedAt.trim())
      throw new Error(store + ': vul het oorspronkelijke bronmoment in, inclusief tijdzone.')
    for (const product of products) {
      // Do not trim or normalize source facts: canonical admission must reject
      // unreviewed/unsafe identifiers rather than silently editing evidence.
      rows.push([store, source.observedAt, ...FIELDS.map(key => product[key])])
    }
  }
  if (!rows.length)
    throw new Error('Vul eerst een daadwerkelijk geobserveerd product bij PLUS of DekaMarkt in.')
  return [HEADER.join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n') + '\n'
}

/** Manual entry is an alternative to preparing a spreadsheet, not an
 * alternative to source rights, original identifiers or user review. */
export function ManualOwnSourceEntry({ onPreview, onOpenReview, busy, template, needs }: {
  onPreview: (raw: string, report: (message: string, admitted: boolean) => void) => void
  onOpenReview: (raw: string) => void
  busy: boolean
  template: OfflinePriceSnapshots | null
  needs: readonly PlannerCaptureGuideNeed[]
}) {
  const [open, setOpen] = useState(false)
  const [activeScan, setActiveScan] = useState<{store: Store; index: number} | null>(null)
  const [scanned, setScanned] = useState<{store: Store; index: number; code: string} | null>(null)
  const [confirmedScan, setConfirmedScan] = useState(false)
  const [invalidRow, setInvalidRow] = useState<string | null>(null)
  const [guideStore, setGuideStore] = useState<Store>('PLUS')
  const [guideNeedId, setGuideNeedId] = useState('')
  const [guideMessage, setGuideMessage] = useState('')
  const [sources, setSources] = useState<Record<Store, Source>>({
    PLUS: initialSource(), DekaMarkt: initialSource(),
  })
  const [error, setError] = useState('')
  const [admissionFeedback, setAdmissionFeedback] = useState<{message: string; admitted: boolean; raw: string} | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [pendingDraft, setPendingDraft] = useState<ManualSources | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<ManualSources | null>(null)
  const readTicket = useRef(0)
  function invalidateRestore() {
    setActiveScan(null); setScanned(null); setConfirmedScan(false)
    ++readTicket.current
    setPendingDraft(null)
    setPendingTemplate(null)
    setBackupMessage('')
    setGuideMessage('')
    setAdmissionFeedback(null)
    setInvalidRow(null)
    setAcknowledged(false); setError('')
  }

  function startScan(store: Store, index: number) {
    setScanned(null)
    setConfirmedScan(false)
    setActiveScan({ store, index })
  }
  function captureBarcode(code: string) {
    if (!activeScan) return
    // An EAN/UPC is a physical package code, not necessarily a retailer SKU.
    // Keep it separate from admitted price/source fields until confirmation.
    setScanned({ ...activeScan, code })
    setActiveScan(null)
    setConfirmedScan(false)
  }
  function acceptBarcode(store: Store, index: number) {
    if (!confirmedScan || !scanned || scanned.store !== store ||
        scanned.index !== index) return
    if (!sources[store]?.products[index]) {
      setError('De artikelregel is veranderd. Scan opnieuw.')
      setScanned(null)
      return
    }
    updateProduct(store, index, 'id', scanned.code)
    setBackupMessage('Bevestigde verpakkingscode ingevuld als originele winkelartikelcode. Controleer ook zelf de bron, productnaam en pakprijs.')
  }
  function updateSource(store: Store, observedAt: string) {
    setSources(previous => ({ ...previous, [store]: { ...previous[store], observedAt } }))
    invalidateRestore()
  }
  function updateProduct(store: Store, index: number, field: Field, value: string) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: previous[store].products.map((entry, i) =>
          i === index ? { ...entry, [field]: value } : entry),
      },
    }))
    invalidateRestore()
  }
  function labelSourceForNeed(store: Store, index: number, needId: string) {
    const need = needs.find(item => item.id === needId)
    if (needId && !need) {
      setGuideMessage('Dit ingrediënt staat niet meer in de huidige Planner-week.')
      return
    }
    if (need && sources[store].products.some((row, i) =>
      i !== index && row.needHint?.id === needId)) {
      setGuideMessage(store + ': dit ingrediënt heeft al een invulregel.')
      return
    }
    setSources(previous => ({
      ...previous,
      [store]: { ...previous[store],
        products: previous[store].products.map((row, i) => i !== index ? row : {
          ...row,
          needHint: need ? {
            id: need.id, label: need.label,
            quantity: readablePlannerDemandAmount(need.amount) + ' ' + need.unit,
          } : undefined,
        }),
      },
    }))
    invalidateRestore()
    setGuideMessage('Planner-geheugensteun gekoppeld, zonder originele SKU of prijs te wijzigen. Productreview in Vergelijk blijft verplicht.')
  }
  function addProduct(store: Store) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: [...previous[store].products, emptyEntry()],
      },
    }))
    invalidateRestore()
  }
  function removeProduct(store: Store, index: number) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: previous[store].products.filter((_, i) => i !== index),
      },
    }))
    invalidateRestore()
  }
  // Planner quantities are only reminders for what the household needs.
  // No original retailer SKU/name, availability, pack size, timestamp or
  // price is inferred from this week demand or copied into a capture row.
  function addPlannerNeeds(store: Store, onlyId?: string) {
    const chosen = needs.filter(need => !onlyId || need.id === onlyId)
    if (chosen.some(need => need.id.length > 140 || need.label.length > 180)) {
      setGuideMessage('Een Planner-ingrediënthint is te lang voor dit privéconcept. Gebruik het bestaande weekinvulblad.')
      return
    }
    const existing = sources[store].products
    const missing = chosen.filter(need => !existing.some(row => row.needHint?.id === need.id))
    if (missing.length === 0) {
      setGuideMessage('Deze Planner-ingrediënten staan al in de gekozen winkelinvoer.')
      return
    }
    const empty = (row: Entry) => FIELDS.every(field => !row[field].trim()) && !row.needHint
    const base = existing.filter(row => !empty(row))
    if (base.length + missing.length > 30) {
      setGuideMessage(store + ': onvoldoende plek voor alle gevraagde ingrediënten (maximaal 30 regels). Kies één ingrediënt of gebruik het bestaande week-CSV-blad.')
      return
    }
    const appended = missing.map(need => ({ ...emptyEntry(), needHint: {
      id: need.id, label: need.label,
      quantity: readablePlannerDemandAmount(need.amount) + ' ' + need.unit,
    } }))
    setSources(previous => ({ ...previous, [store]: {
      ...previous[store], products: [...base, ...appended],
    } }))
    invalidateRestore()
    setGuideMessage(store + ': ' + appended.length + ' ongevulde invulregels uit de Planner toegevoegd. Vul zelf de echte winkelproducten en actuele waarnemingen in.')
  }
  function addSameWeekToBothStores() {
    if (needs.some(need => need.id.length > 140 || need.label.length > 180)) {
      setGuideMessage('Een Planner-ingrediënthint is te lang. Gebruik het bestaande weekinvulblad.')
      return
    }
    const staged = {} as ManualSources
    let added = 0
    for (const store of STORES) {
      const source = sources[store]
      const preserved = source.products.filter(row =>
        FIELDS.some(field => !!row[field].trim()) || !!row.needHint)
      const existingIds = new Set(preserved.map(row => row.needHint?.id))
      const missing = needs.filter(need => !existingIds.has(need.id))
      if (preserved.length + missing.length > 30) {
        setGuideMessage(store + ': niet genoeg ruimte voor dezelfde complete week (maximaal 30 regels). Geen van beide winkels is gewijzigd.')
        return
      }
      const products = missing.map(need => ({ ...emptyEntry(), needHint: {
        id: need.id, label: need.label,
        quantity: readablePlannerDemandAmount(need.amount) + ' ' + need.unit,
      } }))
      added += products.length
      staged[store] = { ...source, products: [...preserved, ...products] }
    }
    if (!added) {
      setGuideMessage('De huidige week is al voorbereid bij beide winkels.')
      return
    }
    setSources(staged)
    invalidateRestore()
    setGuideMessage('Voor beide winkels ' + added + ' lege weekregels aangemaakt. Bestaande originele productvelden blijven staan; er zijn geen SKU’s of prijzen verzonnen.')
  }
  function reconcileChangedWeek() {
    const current = new Set(needs.map(item => item.id))
    let dropped = 0
    let preserved = 0
    const next = {} as ManualSources
    for (const store of STORES) {
      const source = sources[store]
      const products: Entry[] = []
      for (const row of source.products) {
        if (row.needHint && !current.has(row.needHint.id)) {
          // Never discard a user-entered original SKU, observation, pack,
          // availability or price. Only truly blank obsolete reminders go.
          if (FIELDS.every(field => !row[field].trim())) {
            dropped++
            continue
          }
          products.push({ ...row, needHint: undefined })
          preserved++
        } else products.push(row)
      }
      next[store] = { ...source, products }
    }
    if (!dropped && !preserved) {
      setGuideMessage('Er zijn geen oude Planner-geheugensteunen om op te schonen.')
      return
    }
    setSources(next)
    invalidateRestore()
    setGuideMessage(dropped + ' lege regels uit vorige weken verwijderd; ' +
      preserved + ' ingevulde originele bronregels behouden zonder oude Planner-koppeling. ' +
      'Geen SKU, prijs of tijdstip gewijzigd.')
  }
  function statusForNeed(store: Store, id: string) {
    const index = sources[store].products.findIndex(row => row.needHint?.id === id)
    if (index < 0) return { index: -1, complete: false }
    const row = sources[store].products[index]
    const required: readonly Field[] = row.available === 'false'
      ? ['id', 'name', 'packUnit', 'available'] : FIELDS
    return { index, complete: !!sources[store].observedAt.trim() &&
      required.every(field => !!row[field].trim()) }
  }
  function jumpToNeed(store: Store, index: number) {
    const card = document.getElementById('supa-manual-' + store + '-' + index)
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }
  function stageOriginalIdentifiers() {
    if (!template) return
    const reused = {} as ManualSources
    for (const store of STORES) {
      const products = template.captures[store]?.products ?? []
      reused[store] = {
        // Historic observation times cannot become new retail evidence.
        observedAt: '',
        products: products.slice(0, 30).map(product => ({
          id: product.id, name: product.name, packAmount: '', packUnit: '',
          packCount: '', priceCents: '', available: '',
        })),
      }
    }
    setPendingTemplate(reused)
    setPendingDraft(null)
    setBackupMessage('Alleen originele identificaties en namen staan klaar. Geen oude prijs, verpakking, beschikbaarheid of bronmoment is overgenomen.')
  }
  function applyOriginalIdentifiers() {
    if (!pendingTemplate) return
    ++readTicket.current
    setSources(pendingTemplate)
    setPendingTemplate(null)
    setAcknowledged(false)
    setError('')
    setBackupMessage('Originele SKU’s en productnamen overgenomen. Vul alle nieuwe waarnemingen zelf opnieuw in.')
  }
  function downloadDraft() {
    setBackupMessage('')
    try {
      const content = exportManualOwnSourceDraft(sources)
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-eigen-winkelbron-invulconcept.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setBackupMessage('Concept lokaal bewaard, inclusief nog onvolledige velden. Geen geverifieerde prijsbron.')
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Concept kon niet worden bewaard.')
    }
  }
  async function readDraft(file: File | undefined) {
    if (!file) return
    const ticket = ++readTicket.current
    setPendingDraft(null); setPendingTemplate(null); setBackupMessage('')
    if (file.size > MANUAL_DRAFT_MAX_BYTES || file.size === 0) {
      setBackupMessage('Kies een ingevuld Supa-invulconcept van maximaal 64 kB.')
      return
    }
    try {
      const raw = await file.text()
      if (ticket !== readTicket.current) return
      const parsed = importManualOwnSourceDraft(raw)
      if (ticket !== readTicket.current) return
      setPendingDraft(parsed)
      setBackupMessage('Concept gelezen maar nog niet overgenomen. Bestaande invoer blijft staan tot bevestiging.')
    } catch (cause) {
      if (ticket === readTicket.current)
        setBackupMessage(cause instanceof Error ? cause.message : 'Conceptbestand ongeldig.')
    }
  }
  function applyDraft() {
    if (!pendingDraft) return
    ++readTicket.current
    setSources(pendingDraft)
    setPendingDraft(null)
    setAcknowledged(false)
    setError('')
    setBackupMessage('Concept hersteld als onbevestigde invoer. Controleer alle bronmomenten en prijzen opnieuw.')
  }
  function sourceRowForLine(csvLine: number) {
    // The form serializes only rows with original retailer fields; Planner
    // reminder-only rows deliberately never occupy a canonical CSV line.
    let line = 1 // source header
    for (const store of STORES) {
      for (const [index, row] of sources[store].products.entries()) {
        if (!FIELDS.some(field => row[field].trim() !== '')) continue
        if (++line === csvLine) return { store, index }
      }
    }
    return null
  }
  function preview() {
    setError('')
    setAdmissionFeedback(null)
    setInvalidRow(null)
    if (!acknowledged) {
      setError('Bevestig eerst dat alle productgegevens en bronmomenten daadwerkelijk door jou zijn vastgelegd.')
      return
    }
    try {
      const raw = serializeManualCapture(sources)
      const ticket = ++readTicket.current
      onPreview(raw, (message, admitted) => {
        if (ticket !== readTicket.current) return
        setAdmissionFeedback({ message, admitted, raw })
        const line = !admitted ? /^CSV-regel (\d+):/u.exec(message) : null
        const row = line ? sourceRowForLine(Number(line[1])) : null
        setInvalidRow(row ? row.store + '-' + row.index : null)
        if (row) window.requestAnimationFrame(() => jumpToNeed(row.store, row.index))
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De handmatige bron kon niet worden voorbereid.')
    }
  }

  const currentNeedIds = new Set(needs.map(need => need.id))
  const obsoleteHints = STORES.reduce((total, store) =>
    total + sources[store].products.filter(row =>
      row.needHint && !currentNeedIds.has(row.needHint.id)).length, 0)
  return <details className="supa-manual-source" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Geen spreadsheet? Voer eigen winkelproducten in via formulier</summary>
    {open && <>
      <p>Maak je eigen PLUS- en/of DekaMarkt-bronblad. Vul <strong>zelf geobserveerde</strong>
        originele artikelcodes, verpakkingen, bedragen in eurocenten en echte
        bronmomenten in. Supa vult geen product, prijs of tijd automatisch aan.
        Ook na dit formulier controleer je de originele SKU’s in Vergelijk.</p>
      {needs.length > 0 && <section className="supa-manual-source__needs">
        <h4>Vul vanuit je geselecteerde weekmandje in</h4>
        <p>De Planner kent jouw <strong>fysieke ingrediëntvraag</strong>, maar
          nog niet het oorspronkelijke artikel van de winkel. Voeg lege
          invulregels toe om tijdens het winkelen per ingrediënt de echte
          productcode, naam, verpakking en waargenomen prijs over te nemen.
          De gevraagde hoeveelheid is een geheugensteun, geen pakinhoud.</p>
        <div className="supa-manual-source__needs-controls">
          <label>Winkel waarvoor je wilt opnemen
            <select value={guideStore} onChange={event => {
              setGuideStore(event.target.value as Store); setGuideMessage('')
            }}>
              {STORES.map(store => <option key={store} value={store}>{store}</option>)}
            </select>
          </label>
          <label>Kies eventueel één weekingrediënt
            <select value={guideNeedId} onChange={event => setGuideNeedId(event.target.value)}>
              <option value="">Alle nog niet toegevoegde ingrediënten</option>
              {needs.map((need, index) => <option key={need.id + ':' + index} value={need.id}>
                {need.label} · {readablePlannerDemandAmount(need.amount)} {need.unit}
              </option>)}
            </select>
          </label>
        </div>
        <button type="button" className="ghost-button" onClick={() =>
          addPlannerNeeds(guideStore, guideNeedId || undefined)}>
          + Maak lege {guideStore}-invulregels vanuit de Planner
        </button>
        <button type="button" className="ghost-button" onClick={addSameWeekToBothStores}>
          + Bereid hetzelfde volledige weekmandje bij BEIDE winkels voor
        </button>
        {guideMessage && <p role="status">{guideMessage}</p>}
        <details className="supa-manual-source__coverage">
          <summary>Invoervoortgang voor hetzelfde weekmandje bij beide winkels</summary>
          <p>Alleen handmatig ingevulde velden; nog geen bevestigde
            productmatch, bronprijs of besparingsbewijs.</p>
          <div className="supa-manual-source__coverage-counts">
            {STORES.map(store => <span key={store}>
              <strong>{store}:</strong> {needs.filter(need =>
                statusForNeed(store, need.id).complete).length} van {needs.length}
              {' '}ingevoerd, nog niet beoordeeld
            </span>)}
          </div>
          <div className="supa-manual-source__coverage-list">
            {needs.slice(0, 30).map((need, index) => <div
              className="supa-manual-source__coverage-row" key={need.id + ':' + index}>
              <strong>{need.label}</strong>
              <small>Nodig: {readablePlannerDemandAmount(need.amount)} {need.unit}</small>
              {STORES.map(store => {
                const status = statusForNeed(store, need.id)
                return <div key={store}>
                  <span><strong>{store}</strong> · {status.index < 0
                    ? 'Geen invulregel' : status.complete
                      ? 'Ingevuld, broncontrole nog nodig'
                      : 'Originele bronvelden ontbreken'}</span>
                  {status.index >= 0 && <button type="button" className="ghost-button"
                    onClick={() => jumpToNeed(store, status.index)}>
                    Open {store}-invulregel
                  </button>}
                </div>
              })}
            </div>)}
            {needs.length > 30 && <small>En {needs.length - 30} andere
              ingrediënten. Gebruik voor de volledige lijst het
              bestaande CSV-invulblad.</small>}
          </div>
        </details>
      </section>}
      {obsoleteHints > 0 && <section className="supa-manual-source__old-week">
        <strong>{obsoleteHints} invulregels verwijzen naar een vorig weekmandje.</strong>
        <p>Ruim uitsluitend lege herinneringsregels op. Ingevulde originele
          productcodes, prijzen, verpakkingen en bronmomenten blijven bestaan,
          maar worden losgemaakt van de oude Planner-week.</p>
        <button type="button" className="ghost-button"
          onClick={reconcileChangedWeek}>
          Werk het formulier veilig bij voor mijn huidige week
        </button>
      </section>}
      {STORES.map(store => {
        const source = sources[store]
        return <fieldset className="supa-manual-source__store" key={store}>
          <legend>{store} — eigen waarneming</legend>
          <label>Werkelijk bronmoment, inclusief tijdzone
            <input type="text" maxLength={40} value={source.observedAt}
              spellCheck={false} autoComplete="off"
              placeholder="JJJJ-MM-DDTuu:mm:ss+02:00"
              onChange={event => updateSource(store, event.currentTarget.value)} />
          </label>
          <small>Alle artikelen hieronder moeten echt op ditzelfde bronmoment zijn
            vastgelegd. Gebruik anders een apart bronbestand; geen geschat moment.</small>
          {source.products.map((product, index) =>
            <div className={'supa-manual-source__product' +
              (invalidRow === store + '-' + index ? ' is-invalid' : '')}
              id={'supa-manual-' + store + '-' + index} key={index}>
              {product.needHint && <p className="supa-manual-source__hint">
                <strong>Planner-herinnering (geen winkelproduct):</strong>
                {' '}{needs.find(need => need.id === product.needHint?.id)
                  ? (() => {
                      const current = needs.find(need => need.id === product.needHint?.id)!
                      return current.label + ' · nodig: ' +
                        readablePlannerDemandAmount(current.amount) + ' ' + current.unit
                    })()
                  : product.needHint.label + ' · oude hoeveelheid: ' + product.needHint.quantity}.
                {!needs.some(need => need.id === product.needHint?.id) &&
                  <em> Deze vraag staat niet meer in de huidige Planner-week.</em>}
              </p>}
              <div className="supa-manual-source__product-heading">
                <strong>Origineel artikel {index + 1}</strong>
                <button type="button" className="ghost-button"
                  onClick={() => removeProduct(store, index)}>
                  Verwijder regel
                </button>
              </div>
              {needs.length > 0 && <label className="supa-manual-source__need-link">
                Planner-ingrediënt voor deze bronregel (alleen geheugensteun)
                <select value={product.needHint?.id ?? ''}
                  onChange={event => labelSourceForNeed(store, index, event.target.value)}>
                  <option value="">Nog niet aan een Planner-ingrediënt gekoppeld</option>
                  {product.needHint && !needs.some(need => need.id === product.needHint?.id) &&
                    <option value={product.needHint.id}>
                      Oude week: {product.needHint.label} — kies een actuele vraag
                    </option>}
                  {needs.map(need => <option key={need.id} value={need.id}>
                    {need.label} · {readablePlannerDemandAmount(need.amount)} {need.unit}
                  </option>)}
                </select>
                <small>Dit verandert je originele artikel of prijs niet
                  en is geen bevestigde productmatch. Controleer de echte SKU in Vergelijk.</small>
              </label>}
              <div className="supa-manual-source__fields">
                <label>Originele SKU / artikelcode
                  <input type="text" maxLength={100} value={product.id}
                    onChange={event => updateProduct(store, index, 'id', event.currentTarget.value)} />
                </label>
                <div className="supa-manual-source__scanner">
                  <button type="button" className="ghost-button"
                    onClick={() => startScan(store, index)}>
                    Optioneel: scan EAN/UPC van deze verpakking
                  </button>
                  {activeScan?.store === store && activeScan.index === index &&
                    <Suspense fallback={<p role="status">Lokale camerascan laden…</p>}>
                      <LocalDeviceBarcodeScanner
                        onAccept={captureBarcode}
                        onClose={() => setActiveScan(null)} />
                    </Suspense>}
                  {scanned?.store === store && scanned.index === index && <div
                    className="supa-manual-source__scan-confirm">
                    <strong>Gescande verpakkingsbarcode: {scanned.code}</strong>
                    <p>Een EAN/UPC is niet altijd de winkelartikelcode. Bevestig
                      uitsluitend als je de code op de originele bron bij
                      deze winkel hebt vergeleken. Geen automatische match.</p>
                    <label>
                      <input type="checkbox" checked={confirmedScan}
                        onChange={event => setConfirmedScan(event.currentTarget.checked)} />
                      Deze barcode komt exact overeen met de originele
                      { ' '}{store}-artikelcode die ik heb waargenomen.
                    </label>
                    <button type="button" disabled={!confirmedScan}
                      onClick={() => acceptBarcode(store, index)}>
                      Neem gecontroleerde code over als SKU
                    </button>
                    <button type="button" className="ghost-button"
                      onClick={() => { setScanned(null); setConfirmedScan(false) }}>
                      Gebruik barcode niet
                    </button>
                  </div>}
                </div>
                <label>Originele productnaam
                  <input type="text" maxLength={160} value={product.name}
                    onChange={event => updateProduct(store, index, 'name', event.currentTarget.value)} />
                </label>
                <label>Inhoud per pak
                  <input type="text" inputMode="decimal" maxLength={20} value={product.packAmount}
                    placeholder="Bijv. 500 of 0,75"
                    onChange={event => updateProduct(store, index, 'packAmount', event.currentTarget.value)} />
                </label>
                <label>Eenheid
                  <select value={product.packUnit}
                    onChange={event => updateProduct(store, index, 'packUnit', event.currentTarget.value)}>
                    <option value="">Kies eenheid</option>
                    <option value="g">gram</option><option value="kg">kilogram</option>
                    <option value="ml">milliliter</option><option value="l">liter</option>
                    <option value="piece">stuks</option>
                  </select>
                </label>
                <label>Aantal verpakkingen per multipack
                  <input type="text" inputMode="numeric" maxLength={5} value={product.packCount}
                    placeholder="Origineel aantal (bijv. 1)"
                    onChange={event => updateProduct(store, index, 'packCount', event.currentTarget.value)} />
                </label>
                <label>Waargenomen pakprijs in hele eurocenten
                  <input type="text" inputMode="numeric" maxLength={7} value={product.priceCents}
                    placeholder="Bijv. 249 is € 2,49"
                    onChange={event => updateProduct(store, index, 'priceCents', event.currentTarget.value)} />
                </label>
                <label>Werkelijk beschikbaar volgens je bron
                  <select value={product.available}
                    onChange={event => updateProduct(store, index, 'available', event.currentTarget.value)}>
                    <option value="">Kies beschikbaarheid</option>
                    <option value="true">Ja, beschikbaar</option>
                    <option value="false">Nee, niet beschikbaar</option>
                  </select>
                </label>
              </div>
              {product.id && source.products.some((other, otherIndex) =>
                otherIndex !== index && other.id === product.id) &&
                <p role="alert" className="supa-manual-source__duplicate">
                  Dubbele artikelcode {product.id} binnen {store}. De bestaande
                  bronimport weigert dezelfde SKU tweemaal bij één winkel.
                </p>}
              {enteredUnitPrice(product) && <p className="supa-manual-source__unit-rate">
                <strong>{enteredUnitPrice(product)}</strong> op basis van uitsluitend
                de door jou ingevulde pakinhoud en pakprijs.
                <small>Indicatieve eenheidsprijs van je eigen invoer;
                  geen geverifieerde winkelprijs, mandtotaal of besparing.
                  Eerst originele bron en artikelmatch bevestigen in Vergelijk.</small>
              </p>}
              <small>Voor een beschikbaar artikel zijn een echte pakinhoud, multipack en
                prijs vereist. Is het artikel daadwerkelijk niet beschikbaar, dan
                mogen die velden leeg blijven. Een onbekend bedrag is nooit € 0.</small>
            </div>)}
          <button type="button" className="ghost-button" disabled={source.products.length >= 30}
            onClick={() => addProduct(store)}>+ Nog een origineel product</button>
          <small>Maximaal 30 producten per winkel via dit formulier. Voor grotere
            bestanden kun je bovenaan CSV of TSV importeren.</small>
        </fieldset>
      })}
      {template && <section className="supa-manual-source__template">
        <h4>Een bestaande eigen winkelbron opnieuw opnemen</h4>
        <p>Herbruik uitsluitend de oorspronkelijke SKU’s en namen van jouw
          al bekeken bron. Oude tijdstempels, prijzen, verpakking en beschikbaarheid
          worden bewust <strong>leeg</strong> gemaakt. Controleer ze opnieuw.</p>
        <button type="button" className="ghost-button" onClick={stageOriginalIdentifiers}>
          Bereid nieuwe opname voor met oude SKU’s (zonder prijzen)
        </button>
        {pendingTemplate && <div className="supa-manual-source__pending" role="status">
          <p>Nieuwe blanco opname: PLUS {pendingTemplate.PLUS.products.length} originele
            {' '}SKU’s; DekaMarkt {pendingTemplate.DekaMarkt.products.length} originele
            {' '}SKU’s. Per winkel maximaal 30; de rest blijft in de originele bron.</p>
          <button type="button" onClick={applyOriginalIdentifiers}>
            Vervang mijn formulier door de lege herhaalopname
          </button>
          <button type="button" className="ghost-button" onClick={() => {
            setPendingTemplate(null)
            setBackupMessage('Herhaalopname geannuleerd. Jouw huidige invoer blijft staan.')
          }}>Annuleer herhaalopname</button>
        </div>}
      </section>}
      <details className="supa-manual-source__backup">
        <summary>Invulconcept bewaren of openen (ook als het nog niet af is)</summary>
        <p>Het invulconcept bevat uitsluitend jouw ingevoerde gegevens. Het wordt
          lokaal gedownload en niet naar Supa verstuurd. Terugzetten maakt
          geen winkelprijzen of bronrechten geldig.</p>
        <button type="button" className="ghost-button" onClick={downloadDraft}>
          Download mijn huidige invulconcept
        </button>
        <label>Open een eerder Supa-invulconcept (.json)
          <input type="file" accept=".json,application/json"
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void readDraft(file)
            }} />
        </label>
        {pendingDraft && <div role="status" className="supa-manual-source__pending">
          <p>Concept klaar voor herstel: PLUS {pendingDraft.PLUS.products.length}
            {' '}regels; DekaMarkt {pendingDraft.DekaMarkt.products.length} regels.
            Je huidige invoer wordt alleen na je bevestiging vervangen.</p>
          <button type="button" onClick={applyDraft}>Vervang mijn invoer door dit concept</button>
          <button type="button" className="ghost-button" onClick={() => {
            ++readTicket.current; setPendingDraft(null)
            setBackupMessage('Herstel geannuleerd. Huidige invoer ongewijzigd.')
          }}>Annuleren</button>
        </div>}
        {backupMessage && <p role="status">{backupMessage}</p>}
      </details>
      <label className="supa-manual-source__confirmation">
        <input type="checkbox" checked={acknowledged}
          onChange={event => { setAcknowledged(event.currentTarget.checked); setError('') }} />
        Ik heb deze originele productgegevens en bronmomenten zelf rechtmatig
        verkregen en bewust ingevuld; ik begrijp dat dit geen onafhankelijke
        prijs- of toestemmingsverificatie is.
      </label>
      <button type="button" disabled={busy || !acknowledged} onClick={preview}>
        Zet mijn invoer om naar de bestaande broncontrole
      </button>
      {error && <p role="alert">{error}</p>}
      {admissionFeedback && <p role={admissionFeedback.admitted ? 'status' : 'alert'}>
        <strong>{admissionFeedback.admitted ? 'Bronpreview geopend:' : 'Corrigeer je invoer:'}</strong>
        {' '}{admissionFeedback.message}
      </p>}
      {admissionFeedback?.admitted && <button type="button"
        onClick={() => onOpenReview(admissionFeedback.raw)}>
        Controleer mijn geaccepteerde bron in Vergelijk en koppel de producten
      </button>}
    </>}
  </details>
}
