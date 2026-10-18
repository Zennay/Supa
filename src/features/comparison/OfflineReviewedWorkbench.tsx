import { useEffect, useMemo, useRef, useState } from 'react'
import type { OfflineComparisonSession } from './offlineComparisonSession.ts'
import { offlineSessionBaskets, offlineSessionFingerprint, offlineSessionFresh } from './offlineSessionBaskets.ts'
import { aggregatePlanIngredients, buildOneStoreBasket, type RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, parseSingleOfflineCapture, type OfflinePriceSnapshots, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import { LocalTwoStorePriceEditor } from './LocalTwoStorePriceEditor.tsx'
import { PrivateStoreTripChecklist } from './PrivateStoreTripChecklist.tsx'
import { PrivateBasketComparisonExport } from './PrivateBasketComparisonExport.tsx'
import { TwoStoreIngredientLedger } from './TwoStoreIngredientLedger.tsx'
import { MissingPriceChecklist } from './MissingPriceChecklist.tsx'
import { ComparisonReadiness } from './ComparisonReadiness.tsx'
import { StagedStorePreview } from './StagedStorePreview.tsx'
import { stagedStoreFingerprint } from './stagedStoreFingerprint.ts'
import { LocalProductPicker } from './LocalProductPicker.tsx'
import { unresolvedProductGuidance } from './unresolvedProductGuidance.ts'
import { privateUnitPrice } from './privateUnitPrice.ts'
import { createPrivateMatchBackup, readPrivateMatchBackup } from './privateMatchChoicesBackup.ts'
import { createPrivateComparisonArchive, readPrivateComparisonArchive } from './privateComparisonArchive.ts'
import './offlineReviewedWorkbench.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores = ['PLUS', 'DekaMarkt'] as const
const EMPTY_MANUAL_CHOICES: Readonly<Record<string, string>> = Object.freeze({})
const manualKey = (store: string, ingredientId: string) => store + '\u0000' + ingredientId
function captureDate(ms: number) { return dateTime.format(new Date(ms)) }
function blankSheetProductId(store: OfflineRetailer, label: string, index: number): string {
  // Only an ingredient locator, never a claimed store SKU.
  const slug = label.normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54)
  return `own-${store === 'PLUS' ? 'plus' : 'deka'}-${index + 1}-${slug || 'ingredient'}`
}
function safeReferenceLabel(label: string): string {
  return label.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, 160)
}

/** Independent opt-in local import. Never treats JSON as evidence of retailer licensing or physical verification. */
export function OfflineReviewedWorkbench({
  plan, recipes, activeDays, budgetEuros, session, onOpenList, onOpenPlanner,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  budgetEuros?: number
  session: OfflineComparisonSession
  onOpenList?: () => void
  onOpenPlanner?: () => void
}) {
  const ingredientNeeds = useMemo(() => {
    try {
      return aggregatePlanIngredients(plan, recipes, activeDays)
        .filter(need => need.id.trim() && need.label.trim() &&
          ['g', 'kg', 'ml', 'l', 'piece'].includes(need.unit))
    } catch { return [] }
  }, [plan, recipes, activeDays])

  /** A deliberately incomplete field sheet, never price/source evidence. */
  function downloadBlankObservationSheet(selectedStore?: OfflineRetailer) {
    if (!ingredientNeeds.length || ingredientNeeds.length > 1000) return
    const header = 'retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available'
    const rows = (selectedStore ? [selectedStore] : stores).flatMap(store =>
      ingredientNeeds.map((need, index) => {
        const id = blankSheetProductId(store, need.label, index)
        // Deliberately blank physical observation, product name, pack and price.
        // The downstream importer refuses these rows until completed honestly.
        return [store, '', id, '', '', need.unit, '', '', 'false'].join(',')
      }),
    )
    const csv = [header, ...rows].join('\r\n') + '\r\n'
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = selectedStore === 'PLUS' ? 'supa-plus-leeg-prijsblad.csv'
        : selectedStore === 'DekaMarkt' ? 'supa-dekamarkt-leeg-prijsblad.csv'
          : 'supa-weekmenu-lege-prijswaarnemingen.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    }
  }

  /** A human-readable crosswalk for the deliberately blank CSV sheet. */
  function downloadIngredientReference(selectedStore?: OfflineRetailer) {
    if (!ingredientNeeds.length || ingredientNeeds.length > 1000) return
    const targets = selectedStore ? [selectedStore] : stores
    const lines = [
      'SUPA - REFERENTIE BIJ HET LEGE PRIJSINVULBLAD',
      'Huidig gekozen weekmenu: echte ingredientbehoefte uit Planner.',
      'De ID in CSV is slechts een lokaal invulplaatsnummer, GEEN retailerartikel.',
      'Vul productnaam, echte observatietijd, fysieke verpakking, beschikbaarheid',
      'en prijs alleen in na jouw eigen rechtmatige bronwaarneming.',
      'Onbekende prijs blijft leeg; available=false. Geen publieke besparingsclaim.',
      '',
      ...ingredientNeeds.flatMap((need, index) =>
        targets.map(store => {
          const amount = need.amount === null ? 'onbekend' : String(need.amount)
          return `${index + 1}. ${store} | ${blankSheetProductId(store, need.label, index)} | ${safeReferenceLabel(need.label)} | nodig: ${amount} ${need.unit}`
        })),
      '',
      'Het ingevulde CSV-bestand en deze referentie zijn geen licentie of veldbewijs.',
    ]
    const text = lines.join('\n') + '\n'
    if (new TextEncoder().encode(text).length > 512000) {
      setMessage('Het referentieblad is te groot. Maak je weekplanning kleiner.')
      return
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = selectedStore === 'PLUS' ? 'supa-plus-ingredientreferentie.txt'
        : selectedStore === 'DekaMarkt' ? 'supa-deka-ingredientreferentie.txt'
          : 'supa-beide-winkels-ingredientreferentie.txt'
      document.body.append(link); link.click(); link.remove()
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    setMessage('Ingrediëntreferentie lokaal gedownload; productprijzen en waarnemingstijden blijven leeg.')
  }

  const {
    text, setText, imported, setImported, importEpoch, setImportEpoch,
    stagedCaptures: storedStages, setStagedCaptures,
    manualSelections, setManualSelections,
  } = session
  // The textarea is a draft; the shared session text contains only admitted source bytes.
  const [draftText, setDraftText] = useState(() => text)
  const [message, setMessage] = useState('')
  const [pendingReplacement, setPendingReplacement] = useState<{
    sourceText: string
    json: string
    retailer: OfflineRetailer
    previousObservedAt: string
    nextObservedAt: string
    previousCount: number
    nextCount: number
    added: number
    removed: number
    changed: number
    priceExamples: Array<{ name: string; before: string; after: string }>
    resetManualMatches: number
    resetExtraProducts: number
    resetTripTicks: number
    currentEnough: boolean
    pairedWithin24h: boolean
  } | null>(null)
  const [onlyUnresolved, setOnlyUnresolved] = useState<Record<OfflineRetailer, boolean>>({ PLUS: false, DekaMarkt: false })
  const [busy, setBusy] = useState(false)
  const [matchBackupPreview, setMatchBackupPreview] = useState<{
    fingerprint: string; choices: Record<string, string>
  } | null>(null)
  const [matchBackupError, setMatchBackupError] = useState('')
  const [matchBackupBusy, setMatchBackupBusy] = useState(false)
  const matchBackupVersion = useRef(0)
  const [archivePreview, setArchivePreview] = useState<
    Awaited<ReturnType<typeof readPrivateComparisonArchive>> | null>(null)
  const [archiveError, setArchiveError] = useState('')
  const [archiveBusy, setArchiveBusy] = useState(false)
  const archiveVersion = useRef(0)
  const importVersion = useRef(0)
  // User-supplied single-store observations stay in private App memory only.
  // The ref makes consecutive uploads synchronous; App owns state across tabs.
  const stagedCaptures = useRef(storedStages)
  const stagedStores = stores.filter(store => !!storedStages[store])
  useEffect(() => () => { importVersion.current++ }, [])
  function clearStaged() {
    stagedCaptures.current = {}
    setStagedCaptures({})
    session.setStagedManual({
      PLUS: { fingerprint: '', products: {} },
      DekaMarkt: { fingerprint: '', products: {} },
    })
  }
  function clearPrivateSession() {
    setPendingReplacement(null)
    archiveVersion.current++
    setArchivePreview(null)
    matchBackupVersion.current++
    setMatchBackupPreview(null)
    importVersion.current++
    setBusy(false)
    clearStaged()
    setImported(null)
    setText('')
    setDraftText('')
    setManualSelections({ fingerprint: '', products: {} })
    session.setReviewTarget(null)
    session.setTripMemory({})
    session.setExtraProductIds({ PLUS: [], DekaMarkt: [] })
    session.setExtraDoneIds({ PLUS: [], DekaMarkt: [] })
    session.setExtraQuantities({ PLUS: {}, DekaMarkt: {} })
    setImportEpoch(epoch => epoch + 1)
  }
  function importOneStore(content: string) {
    const { retailer, capture } = parseSingleOfflineCapture(content, Date.now())
    const previousCapture = stagedCaptures.current[retailer]
    // Each staged selection belongs to the exact original source bytes. A new
    // capture never inherits stale prices, checkmarks or loose pack quantities.
    const unchangedCapture = !!previousCapture &&
      JSON.stringify(previousCapture) === JSON.stringify(capture)
    if (!unchangedCapture) {
      session.setStagedManual(previous => ({
        ...previous, [retailer]: { fingerprint: '', products: {} },
      }))
      session.setExtraProductIds(previous => ({ ...previous, [retailer]: [] }))
      session.setExtraDoneIds(previous => ({ ...previous, [retailer]: [] }))
      session.setExtraQuantities(previous => ({ ...previous, [retailer]: {} }))
      // Progress is bound to one exact source and basket. An altered capture
      // must not inherit checkmarks, even when its product IDs look identical.
      session.setTripMemory(previous => ({ ...previous, [retailer]: undefined }))
    }
    const next = { ...stagedCaptures.current, [retailer]: capture }
    stagedCaptures.current = next
    setStagedCaptures(next)
    // First store never becomes an apparently valid comparison.
    setImported(null)
    setText('')
    if (!next.PLUS || !next.DekaMarkt) {
      setMessage(`${retailer} lokaal geladen. Importeer nu de andere winkel; er zijn nog geen vergelijkbare mandjes.`)
      return
    }
    const joined = JSON.stringify({ schema: 'supa-offline-prices-v1',
      captures: [next.PLUS, next.DekaMarkt] })
    // Reuse the complete canonical gate, including 256 kB, timestamps,
    // package fields, duplicate IDs and incomplete / stale price handling.
    setText(joined)
    // The new/changed store never carries previous selections into the pair.
    // The untouched staged capture may keep its own reviewed source-bound choices.
    const eligible = stores.filter(store => store !== retailer || unchangedCapture)
    if (importSnapshots(joined, eligible)) {
      // Once paired admission succeeds, the canonical pair owns the data.
      // Do not show duplicate staged banners or a misleading extra wipe action.
      clearStaged()
    }
  }

  // Prevent stale imports from appearing comparable after an open browser tab
  // crosses a 7-day boundary. Refresh only the UI clock, not source observations.
  // Manual decisions belong to the exact imported products/prices and plan.
  // Older selection state cannot affect a newly uploaded or edited observation.
  const importFingerprint = useMemo(() =>
    offlineSessionFingerprint(imported, plan, recipes, activeDays),
    [imported, plan, recipes, activeDays])
  const choices: Readonly<Record<string, string>> =
    manualSelections.fingerprint === importFingerprint
      ? manualSelections.products : EMPTY_MANUAL_CHOICES
  useEffect(() => {
    matchBackupVersion.current++
    setMatchBackupPreview(null)
    setMatchBackupError('')
    archiveVersion.current++
    setArchivePreview(null)
  }, [importFingerprint])
  function chooseProduct(store: 'PLUS' | 'DekaMarkt', ingredientId: string, productId: string) {
    if (!imported || !importFingerprint) return
    setManualSelections(previous => {
      const products = previous.fingerprint === importFingerprint
        ? { ...previous.products } : {}
      const id = manualKey(store, ingredientId)
      if (productId) products[id] = productId
      else delete products[id]
      return { fingerprint: importFingerprint, products }
    })
  }
  const [clockMs, setClockMs] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setClockMs(Date.now())
    const interval = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  function downloadOwnObservationJson() {
    // The textarea is exactly the user-provided, successfully admitted JSON
    // (or locally converted CSV). Do not serialize the internal StoreProduct:
    // unresolved/null prices must never be re-exported as fabricated zeroes.
    if (!imported || !text.trim()) return
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'application/json;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-mijn-prive-winkelopnames.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }

  function downloadIndividualObservation(store: OfflineRetailer) {
    if (!imported || !text.trim()) return
    try {
      // Export exactly the admitted, user-provided observation, not the
      // normalized in-memory price model where null is not distinguishable
      // from unavailable zero. No invented fields or inferred timestamps.
      const original: unknown = JSON.parse(text)
      if (!original || typeof original !== 'object' || Array.isArray(original)) return
      const captures = (original as { captures?: unknown }).captures
      if (!Array.isArray(captures) || captures.length !== 2) return
      const capture = captures.find(item => item && typeof item === 'object' &&
        (item as { retailer?: unknown }).retailer === store)
      if (!capture) return
      const single = JSON.stringify({ schema: 'supa-offline-store-capture-v1', capture }) + '\n'
      // Re-admit the generated single file before making it exportable.
      parseSingleOfflineCapture(single, Date.now())
      const url = URL.createObjectURL(new Blob([single], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = store === 'PLUS' ? 'supa-mijn-plus-opname.json' : 'supa-mijn-dekamarkt-opname.json'
        document.body.append(link)
        link.click()
        link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage(`Jouw oorspronkelijke ${store}-opname gedownload als afzonderlijk JSON-bestand.`)
    } catch {
      setMessage('Deze bronopname kan niet veilig afzonderlijk worden geëxporteerd.')
    }
  }

  function importSnapshots(input: string, retainStagedStores: readonly OfflineRetailer[] = []): boolean {
    try {
      const parsed = parseOfflinePriceSnapshots(input, Date.now())
      setClockMs(Date.now())
      // Recalculating the exact same admitted observations should not erase
      // unrelated extra quantities/checkmarks or force reviewed matches again.
      // A changed capture always invalidates the previous source-bound choices.
      const sameSource = !!imported &&
        offlineSessionFingerprint(imported, plan, recipes, activeDays) ===
          offlineSessionFingerprint(parsed, plan, recipes, activeDays)
      if (!sameSource) {
        setImportEpoch(epoch => epoch + 1)
        const preservedMatches: Record<string, string> = {}
        const currentProducts: Record<OfflineRetailer, Set<string>> = {
          PLUS: new Set(parsed.captures.PLUS.products.filter(p => p.available).map(p => p.id)),
          DekaMarkt: new Set(parsed.captures.DekaMarkt.products.filter(p => p.available).map(p => p.id)),
        }
        for (const store of retainStagedStores) {
          const capture = stagedCaptures.current[store]
          const saved = session.stagedManual[store]
          if (!capture || !saved || saved.fingerprint !==
            stagedStoreFingerprint(capture, plan, recipes, activeDays)) continue
          for (const [ingredientId, productId] of Object.entries(saved.products)) {
            if (currentProducts[store].has(productId) || productId === '!') {
              preservedMatches[manualKey(store, ingredientId)] = productId
            }
          }
        }
        setManualSelections({
          fingerprint: offlineSessionFingerprint(parsed, plan, recipes, activeDays),
          products: preservedMatches,
        })
        // Keep only checkbox progress from the untouched original captures.
        // PrivateStoreTripChecklist independently binds it to the *entire*
        // recalculated basket, so altered prices/demand never inherit ticks.
        session.setTripMemory(previous => ({
          PLUS: retainStagedStores.includes('PLUS') ? previous.PLUS : undefined,
          DekaMarkt: retainStagedStores.includes('DekaMarkt') ? previous.DekaMarkt : undefined,
        }))
        if (retainStagedStores.length > 0) {
          // Both staged captures were canonical-admitted from the same files
          // we are now joining. Carry only still-present selected product IDs.
          const retainedIds = { PLUS: [] as string[], DekaMarkt: [] as string[] }
          const retainedDone = { PLUS: [] as string[], DekaMarkt: [] as string[] }
          const retainedPacks = {
            PLUS: {} as Record<string, number>,
            DekaMarkt: {} as Record<string, number>,
          }
          for (const store of stores) {
            if (!retainStagedStores.includes(store)) continue
            const sourceIds = new Set(parsed.captures[store].products.map(item => item.id))
            retainedIds[store] = session.extraProductIds[store].filter(id => sourceIds.has(id))
            retainedDone[store] = session.extraDoneIds[store].filter(id => retainedIds[store].includes(id))
            for (const id of retainedIds[store]) {
              const packs = session.extraQuantities[store][id]
              retainedPacks[store][id] = Number.isSafeInteger(packs) && packs >= 1 && packs <= 99
                ? packs : 1
            }
          }
          session.setExtraProductIds(retainedIds)
          session.setExtraDoneIds(retainedDone)
          session.setExtraQuantities(retainedPacks)
        } else {
          session.setExtraProductIds({ PLUS: [], DekaMarkt: [] })
          session.setExtraDoneIds({ PLUS: [], DekaMarkt: [] })
          session.setExtraQuantities({ PLUS: {}, DekaMarkt: {} })
        }
      }
      setImported(parsed)
      setMessage(sameSource
        ? 'Dezelfde geldige privéopnames opnieuw berekend; je productkeuzes en losse artikelen zijn behouden.'
        : retainStagedStores.length > 0
          ? 'Beide privéopnames geladen. Geldige keuzes uit ongewijzigde winkelbronnen en Planner zijn meegenomen; controleer de vergelijking.'
          : 'Twee privéopnames lokaal geladen; Supa heeft geen gegevens naar een server verstuurd.')
      return true
    } catch (error) {
      // An invalid draft never revokes an already admitted original capture.
      setMessage((error instanceof Error ? error.message : 'Ongeldige import.') +
        ' Het eerder toegelaten winkelmandje blijft behouden.')
      return false
    }
  }
  /** Paste is admitted through exactly the same local JSON/CSV adapters as
   * file upload, and never creates a missing retailer or relaxed price rule. */
  async function importPastedData() {
    setPendingReplacement(null)
    const supplied = draftText
    if (!supplied.trim()) return
    const version = ++importVersion.current
    setBusy(true)
    setMessage('Geplakte brongegevens worden uitsluitend lokaal verwerkt.')
    try {
      let json = supplied
      if (!supplied.trimStart().startsWith('{')) {
        // Import the existing strict converter asset. The pasted CSV never
        // leaves the browser and no second CSV validation path is invented.
        const moduleUrl = new URL('offline-two-store-csv.mjs',
          new URL(import.meta.env.BASE_URL, window.location.origin)).href
        const adapter: {
          convertTwoStoreCsv: (input: string) => string
          convertSingleStoreCsv: (input: string) => string
        } = await import(/* @vite-ignore */ moduleUrl)
        if (version !== importVersion.current) return
        try { json = adapter.convertTwoStoreCsv(supplied) }
        catch (pairedError) {
          try { json = adapter.convertSingleStoreCsv(supplied) }
          catch { throw pairedError }
        }
      }
      if (version !== importVersion.current) return
      const root: unknown = JSON.parse(json)
      if (root && typeof root === 'object' && !Array.isArray(root) &&
        (root as Record<string, unknown>).schema === 'supa-offline-store-capture-v1') {
        if (imported && text) stageStoreReplacement(json)
        else importOneStore(json)
        setDraftText(json)
      } else if (importSnapshots(json)) {
        // Only canonical original bytes become the App-owned price source.
        setText(json)
        setDraftText(json)
        clearStaged()
      }
    } catch (error) {
      if (version !== importVersion.current) return
      setMessage((error instanceof Error ? error.message : 'Deze brongegevens zijn ongeldig.') +
        ' Je eerdere geldige prijsopnames blijven behouden; dit concept telt niet mee.')
    } finally {
      if (version === importVersion.current) setBusy(false)
    }
  }

  async function loadFile(file?: File) {
    if (!file) return
    setPendingReplacement(null)
    const version = ++importVersion.current
    const previousImported = imported
    const previousText = text
    // Keep the PREVIOUSLY admitted sources visible until the entire incoming
    // capture is admitted atomically. It remains the old labelled comparison,
    // not an assertion that partially read bytes are an updated price source.
    // Cancelling the pending file read must not erase valid user work.
    setBusy(true)
    setMessage('Nieuw bestand wordt privé gelezen. Tot acceptatie blijft de oude vergelijking ongewijzigd.')
    try {
      if (file.size > 256000) throw new Error('Bestand is te groot (maximaal 256 kB).')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv'
      let json = content
      if (!isCsv && content.includes('supa-offline-store-capture-v1')) {
        const root: unknown = JSON.parse(content)
        if (root && typeof root === 'object' && !Array.isArray(root) &&
          (root as Record<string, unknown>).schema === 'supa-offline-store-capture-v1') {
          if (version !== importVersion.current) return
          if (previousImported && previousText) {
            stageStoreReplacement(content)
            setImported(previousImported)
          }
          else importOneStore(content)
          setDraftText(content)
          return
        }
      }
      if (isCsv) {
        // Vite copies public assets unchanged. Resolve within the deployed base,
        // not the site root, so preview and subpath deployments both work.
        const moduleUrl = new URL('offline-two-store-csv.mjs',
          new URL(import.meta.env.BASE_URL, window.location.origin)).href
        const converter: {
          convertTwoStoreCsv: (input: string) => string
          convertSingleStoreCsv: (input: string) => string
        } = await import(/* @vite-ignore */ moduleUrl)
        try { json = converter.convertTwoStoreCsv(content) }
        catch (pairedError) {
          // Only the existing converter parses CSV; do not introduce a weaker
          // second CSV parser or silently manufacture a missing retailer.
          try { json = converter.convertSingleStoreCsv(content) }
          catch { throw pairedError }
        }
      }
      if (version !== importVersion.current) return
      const converted: unknown = JSON.parse(json)
      if (converted && typeof converted === 'object' && !Array.isArray(converted) &&
        (converted as Record<string, unknown>).schema === 'supa-offline-store-capture-v1') {
        if (previousImported && previousText) {
          stageStoreReplacement(json)
          setImported(previousImported)
        }
        else importOneStore(json)
        setDraftText(json)
        return
      }
      // A rejected replacement must not erase a previously accepted capture.
      // Defer stage clearing until the strict pair admission succeeds.
      if (importSnapshots(json)) {
        setText(json)
        setDraftText(json)
        clearStaged()
      } else setImported(previousImported)
    } catch (error) {
      if (version !== importVersion.current) return
      setText(previousText)
      setImported(previousImported)
      setMessage((error instanceof Error ? error.message : 'Kon dit bestand niet lezen.') +
        ' Je eerdere geldige opname is behouden.')
    } finally {
      if (version === importVersion.current) setBusy(false)
    }
  }

  async function loadFiles(files: FileList | null) {
    if (!files?.length) return
    setPendingReplacement(null)
    if (files.length === 1) { await loadFile(files[0]); return }
    // Two independent captures can be selected together without ever treating
    // the first uploaded store as an admissible or priced two-store basket.
    const version = ++importVersion.current
    const previousImported = imported
    const previousText = text
    // Never clear an admitted pair just because an asynchronous two-file
    // read began; a later manual edit may invalidate the unfinished read.
    if (files.length !== 2) {
      setImported(previousImported)
      setMessage('Selecteer één gecombineerd bestand of precies twee afzonderlijke winkelbestanden.')
      return
    }
    setBusy(true)
    setMessage('Beide bestanden worden privé op dit apparaat gelezen en gecontroleerd.')
    try {
      const captures: Partial<Record<OfflineRetailer, Record<string, unknown>>> = {}
      for (const file of Array.from(files)) {
        if (file.size > 256000) throw new Error('Bestand is te groot (maximaal 256 kB).')
        const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        if (version !== importVersion.current) return
        let json = content
        if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
          const moduleUrl = new URL('offline-two-store-csv.mjs',
            new URL(import.meta.env.BASE_URL, window.location.origin)).href
          const converter: { convertSingleStoreCsv: (input: string) => string } =
            await import(/* @vite-ignore */ moduleUrl)
          if (version !== importVersion.current) return
          json = converter.convertSingleStoreCsv(content)
        }
        const { retailer, capture } = parseSingleOfflineCapture(json, Date.now())
        if (captures[retailer]) throw new Error('Twee keer dezelfde winkel geselecteerd. Kies één PLUS- en één DekaMarkt-bestand.')
        captures[retailer] = capture
      }
      if (version !== importVersion.current) return
      if (!captures.PLUS || !captures.DekaMarkt) {
        throw new Error('Selecteer één PLUS- en één DekaMarkt-opname.')
      }
      const combined = JSON.stringify({ schema: 'supa-offline-prices-v1',
        captures: [captures.PLUS, captures.DekaMarkt] })
      // The canonical pair gate remains authoritative for size, age, exact
      // observation timestamps, duplicate IDs, packages and missing prices.
      parseOfflinePriceSnapshots(combined, Date.now())
      if (!importSnapshots(combined)) {
        setImported(previousImported)
        return
      }
      setText(combined)
      setDraftText(combined)
      clearStaged()
      setMessage('PLUS en DekaMarkt zijn samen lokaal geïmporteerd. Controleer nu de productkoppelingen.')
    } catch (error) {
      if (version !== importVersion.current) return
      setImported(previousImported)
      setText(previousText)
      setMessage((error instanceof Error ? error.message : 'Kon de winkelbestanden niet veilig importeren.') +
        ' Je eerdere geldige opname is behouden.')
    } finally {
      if (version === importVersion.current) setBusy(false)
    }
  }

  /** A new retailer capture is only a private PROPOSAL until the user
   * confirms what changes. Validate the exact two-store candidate first.
   * Nothing is written to the active session or other retailer at preview.
   */
  function stageStoreReplacement(json: string) {
    if (!imported || !text) throw new Error('Er is geen bestaand winkelpaar om bij te werken.')
    const { retailer, capture } = parseSingleOfflineCapture(json, Date.now())
    const previous = parseOfflinePriceSnapshots(text, Date.now())
    const previousRaw: unknown = JSON.parse(text)
    if (!previousRaw || typeof previousRaw !== 'object' || Array.isArray(previousRaw)) {
      throw new Error('Bestaande opname kan niet meer worden gecontroleerd.')
    }
    const sourceCaptures = (previousRaw as { captures?: unknown }).captures
    if (!Array.isArray(sourceCaptures) || sourceCaptures.length !== 2) {
      throw new Error('Bestaand bronpaar is ongeldig.')
    }
    const currentStoreCapture = sourceCaptures.find(source =>
      source && typeof source === 'object' &&
      (source as { retailer?: unknown }).retailer === retailer)
    // Re-importing the same canonical observation is a no-op, not permission
    // to discard existing private checkmarks, manual matches or extra items.
    if (currentStoreCapture && JSON.stringify(currentStoreCapture) === JSON.stringify(capture)) {
      setPendingReplacement(null)
      setMessage('Deze ' + retailer + '-opname is gelijk aan de huidige. Alle productkeuzes en afvinkingen blijven behouden.')
      return
    }
    const candidate = JSON.stringify({
      schema: 'supa-offline-prices-v1',
      captures: sourceCaptures.map(source => source && typeof source === 'object' &&
        (source as { retailer?: unknown }).retailer === retailer ? capture : source),
    })
    const next = parseOfflinePriceSnapshots(candidate, Date.now())
    const before = new Map(previous.captures[retailer].products.map(product => [product.id, product] as const))
    const after = new Map(next.captures[retailer].products.map(product => [product.id, product] as const))
    const added = [...after.keys()].filter(id => !before.has(id)).length
    const removed = [...before.keys()].filter(id => !after.has(id)).length
    const changed = [...after].filter(([id, product]) => {
      const old = before.get(id)
      return old && JSON.stringify(old) !== JSON.stringify(product)
    }).length
    // Display only product prices explicitly present in these admitted LOCAL
    // sources. An unavailable pack has no known price, not a zero-cent price.
    const priceLabel = (product: typeof next.captures.PLUS.products[number]) =>
      product.available && Number.isSafeInteger(product.priceCents)
        ? euros.format(product.priceCents / 100) + ' per verpakking (' +
          (product.packAmount ?? '?') + ' ' + product.packUnit + ')'
        : 'prijs onbekend / niet beschikbaar'
    const priceExamples = [...after].flatMap(([id, product]) => {
      const old = before.get(id)
      return old && (old.available !== product.available ||
        (old.available && product.available && old.priceCents !== product.priceCents))
        ? [{ name: safeReferenceLabel(product.name).slice(0, 95),
            before: priceLabel(old), after: priceLabel(product) }]
        : []
    }).slice(0, 8)
    const resetManualMatches = session.manualSelections.fingerprint ===
      offlineSessionFingerprint(imported, plan, recipes, activeDays)
      ? Object.keys(session.manualSelections.products)
        .filter(key => key.startsWith(retailer + String.fromCharCode(0))).length
      : 0
    setPendingReplacement({
      sourceText: text, json, retailer,
      previousObservedAt: previous.captures[retailer].observedAt,
      nextObservedAt: next.captures[retailer].observedAt,
      previousCount: before.size, nextCount: after.size,
      added, removed, changed, priceExamples,
      resetManualMatches,
      resetExtraProducts: session.extraProductIds[retailer].length,
      resetTripTicks: session.tripMemory[retailer]?.done.length ?? 0,
      currentEnough: next.currentEnough,
      pairedWithin24h: next.pairedWithin24h,
    })
    setMessage('Nieuwe ' + retailer + '-opname gecontroleerd maar NIET toegepast. Bekijk de wijzigingen en bevestig bewust.')
  }

  /** A confirmed replacement uses the SAME exact original
   * capture admission, peer-source preservation, and reviewed-match rebinding. */
  function applyStoreReplacement(json: string) {
    if (!imported || !text) throw new Error('Er is geen bestaand twee-winkelpaar om bij te werken.')
    const { retailer, capture } = parseSingleOfflineCapture(json, Date.now())
    // Validate the prior raw source bytes again: never reconstruct them
    // from a normalized StoreProduct with unknown price mapped to zero.
    parseOfflinePriceSnapshots(text, Date.now())
    const previous: unknown = JSON.parse(text)
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
      throw new Error('Bestaande bronopname is niet meer beschikbaar.')
    }
    const captures = (previous as { captures?: unknown }).captures
    if (!Array.isArray(captures) || captures.length !== 2) {
      throw new Error('Bestaande twee-winkelopname is ongeldig.')
    }
    const next = JSON.stringify({ schema: 'supa-offline-prices-v1',
      captures: captures.map(raw => raw && typeof raw === 'object' &&
        (raw as { retailer?: unknown }).retailer === retailer ? capture : raw) })
    const parsed = parseOfflinePriceSnapshots(next, Date.now())
    // A replacement invalidates only that retailer. Rebind surviving,
    // manually reviewed selections to the freshly validated pair fingerprint
    // when the OTHER source and the exact selected week are unchanged.
    // Never carry choices from an earlier week or from a modified retailer.
    const other: OfflineRetailer = retailer === 'PLUS' ? 'DekaMarkt' : 'PLUS'
    const oldFingerprint = offlineSessionFingerprint(imported, plan, recipes, activeDays)
    const nextFingerprint = offlineSessionFingerprint(parsed, plan, recipes, activeDays)
    const otherAvailable = new Set(parsed.captures[other].products
      .filter(product => product.available).map(product => product.id))
    const retainedSelections: Record<string, string> = {}
    if (session.manualSelections.fingerprint === oldFingerprint) {
      const prefix = other + '\u0000'
      for (const [key, productId] of Object.entries(session.manualSelections.products)) {
        if (key.startsWith(prefix) && otherAvailable.has(productId)) {
          retainedSelections[key] = productId
        }
      }
    }
    const otherCatalogIds = new Set(parsed.captures[other].products.map(product => product.id))
    const remainingExtras = session.extraProductIds[other].filter(id => otherCatalogIds.has(id))
    const remainingDone = session.extraDoneIds[other].filter(id => remainingExtras.includes(id))
    const remainingQuantities = Object.fromEntries(remainingExtras.map(id => {
      const packs = session.extraQuantities[other][id]
      return [id, Number.isSafeInteger(packs) && packs >= 1 && packs <= 99 ? packs : 1]
    }))
    clearStaged()
    setManualSelections({ fingerprint: nextFingerprint, products: retainedSelections })
    session.setTripMemory(previous => ({ [other]: previous[other] }))
    session.setExtraProductIds({
      PLUS: other === 'PLUS' ? remainingExtras : [],
      DekaMarkt: other === 'DekaMarkt' ? remainingExtras : [],
    })
    session.setExtraDoneIds({
      PLUS: other === 'PLUS' ? remainingDone : [],
      DekaMarkt: other === 'DekaMarkt' ? remainingDone : [],
    })
    session.setExtraQuantities({
      PLUS: other === 'PLUS' ? remainingQuantities : {},
      DekaMarkt: other === 'DekaMarkt' ? remainingQuantities : {},
    })
    setText(next)
    setDraftText(next)
    setClockMs(Date.now())
    setImportEpoch(epoch => epoch + 1)
    setImported(parsed)
    setMessage(retailer + ' is vervangen. De andere originele winkelopname is onveranderd. ' +
      'Bestaande geldige koppelingen en extra artikelen van ' + other +
      ' zijn bewaard; beoordeel alleen de vernieuwde ' + retailer + '-producten opnieuw.' +
      (parsed.pairedWithin24h ? '' : ' De opnames liggen meer dan 24 uur uiteen: geen vergelijkbaar verschil.'))
  }

  function confirmStoreReplacement() {
    if (!pendingReplacement) return
    const proposal = pendingReplacement
    setPendingReplacement(null)
    if (!imported || text !== proposal.sourceText) {
      setMessage('De eerdere winkelopnames zijn ondertussen gewijzigd. Laad de nieuwe opname opnieuw.')
      return
    }
    try {
      applyStoreReplacement(proposal.json)
    } catch {
      setMessage('Vervanging niet toegepast: huidige bron of tijdstempels zijn niet meer geldig. De oude opnames blijven behouden.')
    }
  }

  async function replaceOneStoreFile(file?: File) {
    if (!file || !imported || !text) return
    setPendingReplacement(null)
    const version = ++importVersion.current
    setBusy(true)
    setMessage('Nieuwe winkelopname wordt lokaal gecontroleerd. De bestaande vergelijking blijft behouden bij een fout.')
    try {
      if (file.size > 256000) throw new Error('Nieuwe opname is groter dan 256 kB.')
      let json = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== importVersion.current) return
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
        const moduleUrl = new URL('offline-two-store-csv.mjs',
          new URL(import.meta.env.BASE_URL, window.location.origin)).href
        const converter: { convertSingleStoreCsv: (input: string) => string } =
          await import(/* @vite-ignore */ moduleUrl)
        if (version !== importVersion.current) return
        json = converter.convertSingleStoreCsv(json)
      }
      stageStoreReplacement(json)
    } catch (error) {
      if (version === importVersion.current) setMessage(
        (error instanceof Error ? error.message : 'Kon de vervanging niet inlezen.') +
        ' Je vorige twee winkelopnames blijven onveranderd.')
    } finally {
      if (version === importVersion.current) setBusy(false)
    }
  }

  const basketPair = useMemo(() =>
    offlineSessionBaskets(session, plan, recipes, activeDays),
    [session.imported, session.manualSelections, plan, recipes, activeDays])
  // Follow an explicit incomplete-line action from Lijst only after the
  // canonical baskets and matching articles for this imported week exist.
  useEffect(() => {
    const target = session.reviewTarget
    if (!target || !basketPair || !imported) return
    if (!(target.store === 'PLUS' ? basketPair.plus : basketPair.deka).lines
      .some(line => line.id === target.ingredientId)) {
      session.setReviewTarget(null)
      return
    }
    setOnlyUnresolved(previous => ({ ...previous, [target.store]: false }))
    const timer = window.setTimeout(() => {
      document.getElementById('offline-match-' + target.store + '-' +
        encodeURIComponent(target.ingredientId))?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      })
      session.setReviewTarget(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [session.reviewTarget, session.setReviewTarget, basketPair, imported])

  const currentEnough = useMemo(() =>
    imported !== null && offlineSessionFresh(imported, clockMs),
    [imported, clockMs])
  const canShowDifference = !!imported && currentEnough && imported.pairedWithin24h &&
    !!basketPair?.comparison.claimable

  // Optional portable match decisions, bound to the exact imported pair and
  // Planner. Never reimports prices, chooses products automatically or uploads.
  const matchCatalogs = imported ? {
    PLUS: imported.captures.PLUS.products, DekaMarkt: imported.captures.DekaMarkt.products,
  } : null
  const matchBaskets = basketPair ? { PLUS: basketPair.plus, DekaMarkt: basketPair.deka } : null
  async function downloadMatchChoices() {
    setMatchBackupError('')
    try {
      if (!matchCatalogs || !matchBaskets || !importFingerprint) return
      const data = await createPrivateMatchBackup(importFingerprint, choices, matchBaskets, matchCatalogs)
      const uri = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-prive-productkeuzes.json'
        document.body.append(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
      setMessage('Productkeuzes lokaal geëxporteerd. Bewaar ook je oorspronkelijke twee winkelopnames apart.')
    } catch (error) {
      setMatchBackupError(error instanceof Error ? error.message : 'Productkeuzes konden niet worden geëxporteerd.')
    }
  }
  async function previewMatchChoices(file?: File) {
    if (!file) return
    const version = ++matchBackupVersion.current
    setMatchBackupPreview(null)
    setMatchBackupError('')
    setMatchBackupBusy(true)
    try {
      if (!matchCatalogs || !matchBaskets || !importFingerprint || file.size > 128000) {
        throw new Error('Laad eerst dezelfde twee winkels en kies een JSON-backup van maximaal 128 kB.')
      }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const selections = await readPrivateMatchBackup(raw, importFingerprint, matchBaskets, matchCatalogs)
      if (version !== matchBackupVersion.current) return
      setMatchBackupPreview({ fingerprint: importFingerprint, choices: selections })
    } catch (error) {
      if (version === matchBackupVersion.current) setMatchBackupError(
        error instanceof Error ? error.message : 'Kon productkeuzes niet herstellen.')
    } finally {
      if (version === matchBackupVersion.current) setMatchBackupBusy(false)
    }
  }
  function applyMatchChoices() {
    if (!imported || !basketPair || !matchBackupPreview ||
        matchBackupPreview.fingerprint !== importFingerprint) {
      setMatchBackupError('Je weekplanning of winkelopnames zijn veranderd; laad de juiste backup opnieuw.')
      return
    }
    setManualSelections({ fingerprint: importFingerprint, products: matchBackupPreview.choices })
    setMatchBackupPreview(null)
    setMessage('Productkeuzes voor precies dit winkelpaar en weekmenu hersteld en opnieuw berekend.')
  }

  async function downloadPrivateSession() {
    setArchiveError('')
    try {
      if (!imported || !text || !matchBaskets || !matchCatalogs || !importFingerprint) {
        throw new Error('Laad eerst een geldig PLUS- en DekaMarkt-winkelpaar.')
      }
      const savedChoices = await createPrivateMatchBackup(
        importFingerprint, choices, matchBaskets, matchCatalogs)
      const content = createPrivateComparisonArchive(text, savedChoices)
      const uri = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = uri
        link.download = 'supa-prive-vergelijking-en-keuzes.json'
        document.body.append(link); link.click(); link.remove()
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
      setMessage('Privévergelijking inclusief eigen bronprijzen en gekoppelde keuzes lokaal gedownload.')
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Het archief kon niet worden gemaakt.')
    }
  }
  async function previewPrivateSession(file?: File) {
    if (!file) return
    const version = ++archiveVersion.current
    setArchivePreview(null)
    setArchiveError('')
    setArchiveBusy(true)
    try {
      if (file.size > 512000) throw new Error('Het archief is groter dan 512 kB.')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const result = await readPrivateComparisonArchive(content, plan, recipes, activeDays,
        parsed => {
          const provisional = offlineSessionBaskets({
            ...session, imported: parsed,
            manualSelections: { fingerprint: '', products: {} },
          }, plan, recipes, activeDays)
          return provisional ? { PLUS: provisional.plus, DekaMarkt: provisional.deka } : null
        })
      if (version !== archiveVersion.current) return
      setArchivePreview(result)
    } catch (error) {
      if (version === archiveVersion.current) setArchiveError(
        error instanceof Error ? error.message : 'Het privéarchief kon niet worden gelezen.')
    } finally { if (version === archiveVersion.current) setArchiveBusy(false) }
  }
  function applyPrivateSession() {
    const next = archivePreview
    if (!next || next.fingerprint !== offlineSessionFingerprint(next.parsed, plan, recipes, activeDays)) {
      setArchiveError('Je Planner is veranderd. Controleer het archief opnieuw.')
      setArchivePreview(null)
      return
    }
    // Atomic, user-confirmed replacement of the in-memory price + matching
    // session. Invalid archives never change the original active comparison.
    importVersion.current++
    matchBackupVersion.current++
    clearStaged()
    setImported(next.parsed)
    setText(next.source)
    setDraftText(next.source)
    setManualSelections({ fingerprint: next.fingerprint, products: next.choices })
    setImportEpoch(epoch => epoch + 1)
    session.setTripMemory({})
    session.setExtraProductIds({ PLUS: [], DekaMarkt: [] })
    session.setExtraDoneIds({ PLUS: [], DekaMarkt: [] })
    session.setExtraQuantities({ PLUS: {}, DekaMarkt: {} })
    setMatchBackupPreview(null)
    setArchivePreview(null)
    setArchiveError('')
    setMessage('Privébronnen en productkeuzes voor deze week hersteld. Oude vinkjes en losse producten zijn niet overgenomen.')
  }

  function downloadMissingItems(store: OfflineRetailer) {
    if (!imported || !basketPair) return
    const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
    const unresolved = basket.lines.filter(line => line.status === 'unresolved')
    if (!unresolved.length) return
    const safeLabel = (label: string) => label
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 160)
    const lines = [
      'SUPA - nog op te zoeken bij ' + store,
      'Huidig weekmenu - ' + unresolved.length + ' niet-gekoppelde ingrediënten',
      'Bronopname: ' + captureDate(imported.captures[store].observedMs),
      'Deze lijst bevat GEEN geverifieerde winkelprijzen of productmatches.',
      '',
      ...unresolved.map((line, index) => {
        const amount = line.requirement.amount
        const needed = amount !== null && Number.isFinite(amount) && amount > 0
          ? String(amount) + ' ' + line.requirement.unit : 'hoeveelheid onbekend'
        return (index + 1) + '. ' + safeLabel(line.ingredientLabel) +
          ' - benodigd: ' + needed
      }),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'],
      { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = store === 'PLUS' ? 'supa-plus-nog-opzoeken.txt' : 'supa-dekamarkt-nog-opzoeken.txt'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    setMessage('Je lijst met ontbrekende ingrediënten voor ' + store + ' is lokaal gedownload.')
  }

  function budgetStatus(store: OfflineRetailer, basket: ReturnType<typeof buildOneStoreBasket>): string | null {
    if (typeof budgetEuros !== 'number' || !Number.isFinite(budgetEuros) || budgetEuros <= 0) return null
    const budgetCents = Math.round(budgetEuros * 100)
    if (!Number.isSafeInteger(budgetCents) || budgetEuros !== budgetCents / 100 ||
        !Number.isSafeInteger(basket.totalCents) || basket.totalCents < 0) return null
    const nowNs = BigInt(Math.trunc(clockMs)) * 1000000n
    const observedNs = imported?.captures[store].observedNs
    if (observedNs === undefined || nowNs < observedNs - 300000000000n ||
        nowNs - observedNs > 604800000000000n) {
      return 'Geen budgetindicatie: deze winkelopname is verlopen of heeft een ongeldige tijd.'
    }
    const complete = basket.selectedMealCount > 0 && basket.lines.length > 0 &&
      basket.unresolvedLineCount === 0
    if (complete) {
      const remaining = budgetCents - basket.totalCents
      return remaining >= 0
        ? euros.format(remaining / 100) + ' ruimte binnen je weekbudget'
        : euros.format(-remaining / 100) + ' boven je weekbudget'
    }
    if (basket.selectedMealCount <= 0 || basket.lines.length === 0) {
      return 'Plan eerst maaltijden om dit weekbudget te vergelijken.'
    }
    const knownOverrun = basket.totalCents - budgetCents
    return knownOverrun > 0
      ? 'Bekende artikelen zijn al minstens ' + euros.format(knownOverrun / 100) +
        ' boven budget; onbekende prijzen ontbreken nog.'
      : 'Budgetruimte nog onbekend: er ontbreken ' + basket.unresolvedLineCount +
        ' productprijzen. Bekende bedragen zijn geen volledig totaal.'
  }

  function focusPairMatch(store: OfflineRetailer, ingredientId: string) {
    setOnlyUnresolved(previous => ({ ...previous, [store]: false }))
    window.requestAnimationFrame(() => {
      document.getElementById('offline-match-' + store + '-' +
        encodeURIComponent(ingredientId))?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      })
    })
  }

  return (
    <section className="offline-price-workbench" aria-label="Geïmporteerde winkelprijzen vergelijken">
      <div className="offline-price-workbench__intro">
        <span className="eyebrow">Jouw planner → brongegevens → winkelmandjes</span>
        <h2>Vergelijk twee winkels met eigen prijsdata</h2>
        <p>Vul producten en prijzen direct per winkel in, of laad eigen geobserveerde winkelprijzen uit JSON of CSV.
          Supa koppelt producten aan jouw huidige weekmenu, rondt verpakkingen naar boven af
          en berekent eenheidsprijzen en volledige mandtotalen. De import start geen scraper of netwerkverzoek.</p>
        <p className="disclaimer">Privé rekenhulp: een aangeleverd bestand bewijst geen toestemming, productidentiteit,
          actuele winkelprijs of besparing. Onbekende producten krijgen nooit een verzonnen prijs.
          PLUS en DekaMarkt zijn hier uitsluitend vergelijkingslabels.</p>
      </div>
      <LocalTwoStorePriceEditor
        plan={plan} recipes={recipes} activeDays={activeDays}
        hasAdmittedPair={!!imported}
        onGenerated={(json) => {
          importVersion.current++
          setBusy(false)
          // One actual store is a usable private basket now, not a fabricated
          // paired observation. Keep the other staged capture and its reviews.
          const root: unknown = JSON.parse(json)
          if (root && typeof root === 'object' && !Array.isArray(root) &&
              (root as { schema?: unknown }).schema === 'supa-offline-store-capture-v1') {
            if (imported && text) {
              // Editing only PLUS or Deka in the form is the same scoped
              // replacement as uploading an individual new original capture.
              // Preserve the untouched store's source/reviews and fail closed.
              try { stageStoreReplacement(json) }
              catch (error) {
                setMessage((error instanceof Error ? error.message : 'Kon deze winkel niet bijwerken.') +
                  ' Je eerder toegelaten winkelpaar is behouden.')
              }
            } else importOneStore(json)
          } else if (importSnapshots(json)) {
            setText(json)
            setDraftText(json)
            clearStaged()
          }
        }}
        onEdit={() => {
          // A user editing the in-app wizard also invalidates a pending file read.
          setPendingReplacement(null)
          importVersion.current++
          setBusy(false)
          // Do not destroy a previously admitted one-store capture simply
          // because the user starts entering the other store in this editor.
          // The editor is a draft. Keep previously admitted pair and one-store
          // baskets visible until the user explicitly admits valid new bytes.
          setMessage('Je wijziging is nog niet toegepast. Bestaande geldige winkelopnames blijven zichtbaar; bereken de nieuwe invoer wanneer je klaar bent.')
        }}
      />
      <details className="offline-price-workbench__schema">
        <summary>Welk importbestand werkt?</summary>
        <p>UTF-8 JSON met <code>schema: "supa-offline-prices-v1"</code> en precies twee
          <code> captures</code>, elk met <code>retailer</code> (PLUS / DekaMarkt),
          <code>observedAt</code> (ISO-tijd met tijdzone) en een <code>products</code>-lijst.
          Elk product bevat <code>id</code>, <code>name</code>, <code>packAmount</code>,
          <code>packUnit</code> (g/kg/ml/l/piece), <code>priceCents</code> (geheel aantal centen of
          null), en <code>available</code> (true/false). Optioneel <code>packCount</code>.
          Gebruik uitsluitend gegevens die je mag bewaren en verwerken.
          Je mag een afzonderlijke JSON- of CSV-opname hieronder ook plakken
          en direct als voorlopige winkelboodschappenlijst openen, zonder prijsverschil.
          Je mag ook twee aparte JSON-bestanden aanleveren. Gebruik dan per bestand
          <code>schema: "supa-offline-store-capture-v1"</code> en één <code>capture</code>
          met dezelfde velden als hierboven. Laad eerst de ene winkel en daarna de andere;
          beide opnames blijven alleen in het geheugen van deze pagina.
          Ontbrekende prijzen: zet <code>priceCents: null</code> en <code>available: false</code>.</p>
      </details>
      <div id="supa-private-price-import" className="offline-price-workbench__input">
        <p>Heb je een spreadsheet met geobserveerde PLUS- en DekaMarkt-prijzen? Importeer hier rechtstreeks
          een CSV met de negen vereiste kolommen, of maak deze eerst in de{' '}
          <a href={`${import.meta.env.BASE_URL}offline-two-store-import.html`} target="_blank" rel="noopener noreferrer">
            lokale CSV-converter (opent in een nieuw tabblad)
          </a>.
          Er wordt niets naar een server verstuurd; ontbrekende prijzen blijven onbekend.</p>
        <div>
          <button type="button" className="ghost-button"
            disabled={ingredientNeeds.length === 0 || ingredientNeeds.length > 1000}
            onClick={() => downloadBlankObservationSheet()}>
            Download leeg CSV-invulblad voor beide winkels
          </button>
          {stores.map(store => <button type="button" key={store} className="ghost-button"
            disabled={ingredientNeeds.length === 0 || ingredientNeeds.length > 1000}
            onClick={() => downloadBlankObservationSheet(store)}>
            Download leeg {store}-prijsblad
          </button>)}
          <button type="button" className="ghost-button"
            disabled={ingredientNeeds.length === 0 || ingredientNeeds.length > 1000}
            onClick={() => downloadIngredientReference()}>
            Download bijbehorende ingrediënten en benodigde hoeveelheden (TXT)
          </button>
          <p className="disclaimer">Dit referentiebestand noemt voor iedere regel exact dezelfde
            lokale CSV-ID, het bedoelde Planner-ingrediënt en de benodigde hoeveelheid.
            De werkelijke supermarktproduct-ID, prijs, verpakking, opnametijd en
            licentie zijn onbekend tot je ze zelf rechtsgeldig vastlegt.</p>
          <p className="disclaimer">Het invulblad bevat alleen de ingrediënten uit Planner, tweemaal (PLUS en DekaMarkt).
            Kies één winkel of beide winkels in één blad. De productnaam, werkelijke waarnemingstijd,
            verpakking en prijs zijn expres leeg:
            pas na je eigen rechtmatige observaties, met een echte tijd per winkel en correcte beschikbaarheid,
            kan dit blad worden geïmporteerd. De product-ID vermeldt welk ingrediënt je moet zoeken;
            die ID is geen geverifieerd winkelartikel.</p>
        </div>
        <label>Importeer één gecombineerd bestand of selecteer twee losse winkelopnames tegelijk vanaf dit apparaat
          <input type="file" multiple accept=".json,.csv,application/json,text/csv" disabled={busy}
            onChange={event => { void loadFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
        </label>
        {imported && <div className="offline-price-workbench__replace">
          <label>Werk één van je bestaande winkelopnames bij (JSON of CSV)
            <input type="file" accept=".json,.csv,application/json,text/csv" disabled={busy}
              onChange={event => { void replaceOneStoreFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
          </label>
          <p className="disclaimer">Vervang PLUS of DekaMarkt afzonderlijk. De andere originele
            opname en haar geldige productkeuzes, losse artikelen en aantallen blijven behouden.
            Supa herberekent pas na volledige bronvalidatie en vraagt om de vernieuwde winkel
            opnieuw te beoordelen.
            Een ongeldig bestand verwijdert je bestaande vergelijking niet.
            Tijdstippen moeten nog steeds maximaal 24 uur uiteenliggen
            om een prijsverschil te mogen tonen.</p>
        </div>}
        {pendingReplacement && imported && <section className="offline-price-workbench__replace-preview"
          aria-label="Controleer de winkelvervanging">
          <h4>{pendingReplacement.retailer} vervangen? Eerst de verschillen bekijken</h4>
          <p><strong>Bestaande opname:</strong> {pendingReplacement.previousObservedAt}<br />
            <strong>Nieuwe opname:</strong> {pendingReplacement.nextObservedAt}</p>
          <p>{pendingReplacement.previousCount} bestaande producten → {pendingReplacement.nextCount} nieuwe producten.
            Toegevoegd: {pendingReplacement.added}; verdwenen: {pendingReplacement.removed};
            gewijzigde productgegevens: {pendingReplacement.changed}.</p>
          {pendingReplacement.priceExamples.length > 0 && <div>
            <strong>Prijsveranderingen in jouw eigen opgenomen producten (max. 8)</strong>
            <ul>{pendingReplacement.priceExamples.map((item, index) =>
              <li key={index}>
                <strong>{item.name}</strong>: {item.before} → {item.after}
              </li>)}</ul>
            <small>Dit zijn alleen verschillen tussen jouw lokale bestanden, geen actuele of onafhankelijk geverifieerde winkelprijzen.</small>
          </div>}
          <p><strong>Wat wordt opnieuw beoordeeld bij deze winkel?</strong><br />
            {pendingReplacement.resetManualMatches} handmatige productkoppelingen,
            {' '}{pendingReplacement.resetExtraProducts} losse productkeuzes en
            {' '}{pendingReplacement.resetTripTicks} afgevinkte winkelregels.
            Deze aantallen worden pas bij bevestigen teruggezet; de andere winkel blijft ongewijzigd.</p>
          <p className="disclaimer">
            Alleen {pendingReplacement.retailer} wordt na bevestiging vervangen.
            Handmatige keuzes, afvinkstatus en extra artikelen van die winkel worden opnieuw beoordeeld.
            De andere winkel behoudt haar eigen oorspronkelijke bron en gekoppelde keuzes.
            {!pendingReplacement.currentEnough &&
              ' De nieuwe opnames zijn te oud of buiten het toegestane tijdvenster: geen actuele prijsvergelijking.'}
            {pendingReplacement.pairedWithin24h
              ? ' De opnametijden vallen binnen 24 uur, maar prijzen en rechten zijn niet onafhankelijk geverifieerd.'
              : ' De opnametijden liggen meer dan 24 uur uiteen: geen vergelijkbare volledige mandprijs.'}
          </p>
          <div className="offline-price-workbench__actions">
            <button type="button" onClick={confirmStoreReplacement} disabled={busy}>
              Bevestig en vervang alleen {pendingReplacement.retailer}
            </button>
            <button type="button" className="ghost-button" onClick={() => {
              setPendingReplacement(null)
              setDraftText(text)
              setMessage('Vervanging geannuleerd. Beide oorspronkelijke winkelopnames zijn behouden.')
            }}>Annuleer, behoud beide winkelopnames</button>
          </div>
        </section>}
        {!imported && stagedStores.length > 0 && <div className="offline-price-workbench__staged" role="status">
          <strong>Losse winkelopnames in geheugen:</strong> {stagedStores.join(' + ')}.
          {stagedStores.length === 1
            ? ' Laad de andere winkel als JSON of CSV. Tot die tijd is alleen deze winkel afzonderlijk beschikbaar, zonder prijsverschil.'
            : ' Beide bestanden geladen; de bestaande regels bepalen of de prijzen vergelijkbaar zijn.'}
          {onOpenList && stagedStores.length === 1 && <button type="button"
            onClick={() => { session.setSelectedStore(stagedStores[0]); onOpenList() }}>
            Open mijn {stagedStores[0]}-boodschappenlijst
          </button>}
          <button type="button" className="ghost-button" onClick={() => {
            clearPrivateSession()
            setMessage('Alle tijdelijke winkelopnames, matches en losse artikelen uit dit tabblad gewist.')
          }}>Wis losse opnames</button>
        </div>}
        {!imported && stagedStores.map(store => (
          <StagedStorePreview key={store} store={store} session={session}
            capture={storedStages[store]!}
            plan={plan} recipes={recipes} activeDays={activeDays} clockMs={clockMs}
          />
        ))}
        <label>Of plak een losse of gecombineerde winkelopname als JSON of CSV
          <textarea rows={5} value={draftText} maxLength={256000} spellCheck={false}
            placeholder={'{"schema":"supa-offline-prices-v1","captures":[...]}'}
            onChange={event => {
              // A pending file read is no longer authoritative after manual edits.
              importVersion.current++
              setPendingReplacement(null)
              setBusy(false)
              setDraftText(event.target.value)
              setMessage('Concept gewijzigd. Bestaande geldige bronnen blijven intact tot de nieuwe gegevens zijn toegelaten.')
            }} />
        </label>
        <div className="offline-price-workbench__actions">
          <button type="button" disabled={busy || !draftText.trim()} onClick={() => { void importPastedData() }}>
            {imported ? 'Herbereken mandjes' : 'Importeer en bereken'}
          </button>
          {draftText !== text && <button type="button" className="ghost-button" disabled={busy}
            onClick={() => {
              setDraftText(imported ? text : '')
              setMessage(imported
                ? 'Concept teruggezet naar je laatst toegelaten winkelpaar. Productkeuzes en lijst zijn behouden.'
                : 'Geplakte concepttekst gewist. Los geïmporteerde winkelopnames blijven bewaard.')
            }}>
            {imported ? 'Herstel vorige geldige broninvoer' : 'Wis alleen geplakt concept'}
          </button>}
          <button type="button" className="ghost-button" disabled={!imported || busy}
            onClick={downloadOwnObservationJson}>
            Bewaar mijn privéprijsopnames als JSON
          </button>
          {stores.map(store => <button type="button" key={store} className="ghost-button"
            disabled={!imported || busy} onClick={() => downloadIndividualObservation(store)}>
            Download mijn {store}-opname apart
          </button>)}
          <button type="button" className="ghost-button" onClick={() => {
            clearPrivateSession()
            setMessage('Alle tijdelijke prijsopnames, productkeuzes, aantallen en vinkjes uit dit tabblad gewist.')
          }}>Wis lokaal geladen data</button>
        </div>
        <details className="offline-match-backup">
          <summary>Mijn volledige privévergelijking bewaren of herstellen</summary>
          <p>Één bestand bevat je eigen ingevoerde PLUS- en DekaMarkt-prijzen, de echte
            opnametijden en je handmatige productkoppelingen. Dit is gevoelige,
            uitsluitend lokale informatie, geen retailerautorisatie of publieke besparingsclaim.
            Herstel vereist dezelfde Planner-week en expliciete bevestiging.</p>
          <div className="offline-price-workbench__actions">
            <button type="button" className="ghost-button" disabled={!imported || busy || archiveBusy}
              onClick={() => { void downloadPrivateSession() }}>
              Download prijsopnames + keuzes (één JSON)
            </button>
            <label>Herstel volledige privévergelijking uit JSON
              <input type="file" accept=".json,application/json" disabled={busy || archiveBusy}
                onChange={event => {
                  void previewPrivateSession(event.currentTarget.files?.[0])
                  event.currentTarget.value = ''
                }} />
            </label>
          </div>
          {archiveBusy && <p role="status">Het archief wordt alleen op dit apparaat gelezen…</p>}
          {archiveError && <p role="alert">{archiveError}</p>}
          {archivePreview && <div className="offline-match-backup__confirm">
            <p role="status">Archief gecontroleerd: {archivePreview.parsed.captures.PLUS.products.length}
              {' '}PLUS-producten, {archivePreview.parsed.captures.DekaMarkt.products.length}
              {' '}DekaMarkt-producten en {Object.keys(archivePreview.choices).length} handmatige keuzes.
              De oorspronkelijke prijzen vervangen na bevestiging je huidige privévergelijking.
              Oude vinkjes en losse producten worden niet overgenomen.</p>
            {!offlineSessionFresh(archivePreview.parsed, clockMs) &&
              <p role="alert">Deze opnames zijn verouderd. Er wordt na herstel geen actueel
                prijsverschil getoond totdat je geldige recente prijzen importeert.</p>}
            <button type="button" onClick={applyPrivateSession}>Bevestig volledig privéherstel</button>
            <button type="button" className="ghost-button"
              onClick={() => setArchivePreview(null)}>Annuleer</button>
          </div>}
        </details>
        <p role="status" aria-live="polite">{message}</p>
      </div>
      {imported && (
        <div className="offline-price-workbench__results">
          <h3>Winkelvergelijking voor jouw huidige weekmenu</h3>
          <div className="offline-price-workbench__dates">
            {stores.map(store => (
              <p key={store}><strong>{store}</strong> · waargenomen {captureDate(imported.captures[store].observedMs)}
                {' '}· {imported.captures[store].products.length} bronproducten</p>
            ))}
          </div>
          <details className="offline-match-backup">
            <summary>Mijn gecontroleerde productkoppelingen bewaren of herstellen</summary>
            <p>Je handmatige PLUS- en Deka-keuzes worden als aparte lokale JSON-backup bewaard,
              zonder prijzen of winkelbrondata. Laad later eerst exact dezelfde twee prijsopnames
              en dezelfde Planner-week. Een andere bron of planning weigert herstel.</p>
            <div className="offline-price-workbench__actions">
              <button type="button" className="ghost-button" disabled={Object.keys(choices).length === 0}
                onClick={() => { void downloadMatchChoices() }}>
                Download mijn {Object.keys(choices).length} productkeuzes
              </button>
              <label>Herstel productkeuzes uit eigen JSON-backup
                <input type="file" accept=".json,application/json" disabled={matchBackupBusy}
                  onChange={event => {
                    void previewMatchChoices(event.currentTarget.files?.[0])
                    event.currentTarget.value = ''
                  }} />
              </label>
            </div>
            {matchBackupBusy && <p role="status">Productkeuzes worden lokaal gecontroleerd…</p>}
            {matchBackupError && <p role="alert">{matchBackupError}</p>}
            {matchBackupPreview && <div className="offline-match-backup__confirm">
              <p role="status">{Object.keys(matchBackupPreview.choices).length} keuzes passen bij
                precies deze winkels, prijzen en Planner-week. Bestaande handmatige productkeuzes
                worden pas na jouw bevestiging vervangen; losse producten en vinkjes blijven intact.</p>
              <button type="button" onClick={applyMatchChoices}>Bevestig herstel productkeuzes</button>
              <button type="button" className="ghost-button"
                onClick={() => setMatchBackupPreview(null)}>Annuleer herstel</button>
            </div>}
          </details>
          {!currentEnough && <p role="alert" className="attention-card">
            Oude prijsdata (ouder dan 7 dagen). Er wordt geen actueel prijsverschil getoond.
          </p>}
          {!imported.pairedWithin24h && <p role="alert" className="attention-card">
            Waarnemingen liggen meer dan 24 uur uiteen. Het prijsverschil is niet vergelijkbaar.
          </p>}
          {!basketPair ? <p role="alert">Deze planning kon niet veilig aan de import worden gekoppeld.</p> : (
            <>
              <div className="offline-price-workbench__totals">
                {stores.map(store => {
                  const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                  const complete = basket.selectedMealCount > 0 && basket.lines.length > 0 &&
                    basket.unresolvedLineCount === 0
                  return (
                    <section key={store}>
                      <h4>{store}</h4>
                      <button type="button" className="ghost-button"
                        aria-pressed={session.selectedStore === store}
                        onClick={() => session.setSelectedStore(store)}>
                        {session.selectedStore === store ? 'Gekozen voor Planner en Lijst' : 'Gebruik deze winkel in Planner en Lijst'}
                      </button>
                      <strong>{complete ? euros.format(basket.totalCents / 100) : 'Geen volledig totaal'}</strong>
                      {!complete && basket.matchedLineCount > 0 && (
                        <span>Bekende regels samen: {euros.format(basket.totalCents / 100)} (geen mandtotaal)</span>
                      )}
                      <span>{basket.matchedLineCount} gekoppeld, {basket.unresolvedLineCount} onbekend</span>
                      {budgetStatus(store, basket) && <span className="offline-price-workbench__budget"
                        aria-live="polite">{budgetStatus(store, basket)}</span>}
                    </section>
                  )
                })}
              </div>
              {(basketPair.plus.unresolvedLineCount > 0 || basketPair.deka.unresolvedLineCount > 0) && (
                <p className="offline-price-workbench__missing" role="status">
                  Deze vergelijking is nog niet volledig. Vul onbekende artikelen in beide winkels in.
                  Bekende deelbedragen zijn geen complete winkelmandprijs en worden niet als besparing vergeleken.
                </p>
              )}
              <p className="offline-price-workbench__difference" role="status">
                {canShowDifference && basketPair.comparison.deltaCents !== null
                  ? basketPair.comparison.deltaCents === 0
                    ? 'Deze twee ingevoerde volledige mandjes hebben hetzelfde rekenkundige totaal.'
                    : `${basketPair.comparison.deltaCents > 0 ? 'PLUS' : 'DekaMarkt'} is op basis van deze eigen invoer ${euros.format(Math.abs(basketPair.comparison.deltaCents) / 100)} goedkoper.`
                  : 'Nog geen vergelijkbaar prijsverschil: ontbrekende producten, verouderde gegevens of ongelijke waarnemingstijden.'}
                <small> Dit is nooit een gecontroleerde publieke besparingsclaim.</small>
              </p>
              <ComparisonReadiness
                plus={basketPair.plus}
                deka={basketPair.deka}
                sourceFresh={currentEnough}
                pairedWithin24h={imported.pairedWithin24h}
                comparable={canShowDifference}
                captures={imported.captures}
                nowMs={clockMs}
                onOpenPlanner={onOpenPlanner}
                onReviewMissing={focusPairMatch}
                onOpenImport={() => document.getElementById('supa-private-price-import')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
              <TwoStoreIngredientLedger
                plus={basketPair.plus}
                deka={basketPair.deka}
                comparison={basketPair.comparison}
                comparable={canShowDifference}
                onReview={focusPairMatch}
                productsByStore={{
                  PLUS: imported.captures.PLUS.products,
                  DekaMarkt: imported.captures.DekaMarkt.products,
                }}
                selections={choices}
                onSelect={chooseProduct}
              />
              <MissingPriceChecklist
                plus={basketPair.plus}
                deka={basketPair.deka}
                plusObservedAt={imported.captures.PLUS.observedAt}
                dekaObservedAt={imported.captures.DekaMarkt.observedAt}
              />
              <PrivateBasketComparisonExport
                plus={basketPair.plus}
                deka={basketPair.deka}
                plusObservedAt={imported.captures.PLUS.observedAt}
                dekaObservedAt={imported.captures.DekaMarkt.observedAt}
                comparable={canShowDifference}
                eligibleNow={() => !!imported && imported.pairedWithin24h &&
                  offlineSessionFresh(imported, Date.now()) && basketPair.comparison.claimable}
              />
              {canShowDifference && basketPair.comparison.lineDeltas.length > 0 && (
                <section className="offline-price-workbench__drivers" aria-label="Prijsverschil per ingrediënt">
                  <h4>Wat veroorzaakt het verschil?</h4>
                  {[...basketPair.comparison.lineDeltas]
                    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
                    .slice(0, 5)
                    .map(line => (
                      <p key={line.id}><strong>{line.ingredientLabel}</strong> · PLUS {euros.format(line.baselineLineTotalCents / 100)}
                        {' '}· DekaMarkt {euros.format(line.candidateLineTotalCents / 100)}
                        {' '}· {line.deltaCents === 0 ? 'zelfde bedrag'
                          : `${euros.format(Math.abs(line.deltaCents) / 100)} verschil`}</p>
                    ))}
                </section>
              )}
              <div className="offline-price-workbench__stores">
                {stores.map(store => {
                  const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                  return (
                    <section key={store}>
                      <h4>{store} · controleer productkoppelingen</h4>
                      <div className="offline-price-workbench__coverage">
                        <strong>{basket.matchedLineCount} van {basket.lines.length} ingrediënten gekoppeld</strong>
                        <progress aria-label={store + ' gekoppelde ingrediënten'}
                          max={basket.lines.length || 1} value={basket.matchedLineCount} />
                        {basket.unresolvedLineCount > 0 && <button type="button" className="ghost-button"
                          aria-pressed={onlyUnresolved[store]}
                          onClick={() => setOnlyUnresolved(previous => ({ ...previous, [store]: !previous[store] }))}>
                          {onlyUnresolved[store] ? 'Toon alle ingrediënten' : 'Toon alleen ontbrekende ingrediënten'}
                        </button>}
                        {basket.unresolvedLineCount > 0 && <button type="button" className="ghost-button"
                          onClick={() => downloadMissingItems(store)}>
                          Download {basket.unresolvedLineCount} ontbrekende ingrediënten als TXT
                        </button>}
                      </div>
                      {onOpenList && <button type="button"
                        className="offline-price-workbench__open-list"
                        onClick={() => { session.setSelectedStore(store); onOpenList() }}>
                        Open mijn {store}-boodschappenlijst
                      </button>}
                      <p className="disclaimer">Kies een product alleen als je zelf hebt gecontroleerd
                        dat het werkelijk bij dit ingrediënt past. Supa gebruikt uitsluitend jouw
                        geïmporteerde producten, met bestaande verpakkings- en prijscontroles.
                        Een handmatige keuze is geen onafhankelijk supermarktbewijs.</p>
                      {basket.lines.filter(line => !onlyUnresolved[store] || line.status === 'unresolved').map(line => (
                        <article key={line.id}
                          id={'offline-match-' + store + '-' + encodeURIComponent(line.id)}
                          className="offline-price-workbench__line">
                          <div>
                            <strong>{line.ingredientLabel}</strong>
                            <span>Benodigd: {line.requirement.amount ?? '?'} {line.requirement.unit}</span>
                            {line.status === 'matched' && <span>{line.productName} · {line.packs} × verpakking</span>}
                            {line.status === 'matched' && <span>Eenheidsprijs: {privateUnitPrice(line) ?? 'onbekend'}</span>}
                            {line.status === 'unresolved' && <span>{unresolvedProductGuidance(line)}</span>}
                            {line.status === 'matched' &&
                              line.reasons.includes('explicit local user selection; not an automatic or verified retailer match') &&
                              <span>Door jou handmatig gekoppeld; dit is geen geverifieerde winkelmatch.</span>}
                            <LocalProductPicker
                              key={`${importEpoch}:${store}:${line.id}`}
                              store={store}
                              ingredient={line.ingredientLabel}
                              requirementUnit={line.requirement.unit}
                              requirementAmount={line.requirement.amount}
                              products={imported.captures[store].products}
                              selected={choices[manualKey(store, line.id)] ?? ''}
                              onSelect={productId => chooseProduct(store, line.id, productId)}
                            />
                          </div>
                          <strong>{line.status === 'matched' ? euros.format(line.lineTotalCents / 100) : '—'}</strong>
                        </article>
                      ))}
                      <PrivateStoreTripChecklist
                        key={JSON.stringify([
                          store,
                          imported.captures[store].observedAt,
                          basket.totalCents,
                          basket.matchedLineCount,
                          basket.unresolvedLineCount,
                          basket.lines.map(line => line.status === 'matched'
                            ? [line.id, line.productId, line.packs, line.pricePerPackCents]
                            : [line.id, 'unknown']),
                        ])}
                        basket={basket}
                        observedAt={imported.captures[store].observedAt}
                        fresh={currentEnough}
                        memoryProgress={session.tripMemory[store]}
                        onMemoryChange={(basketIdentity, done) => session.setTripMemory(previous =>
                          ({ ...previous, [store]: { identity: basketIdentity, done } }))}
                      />
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
