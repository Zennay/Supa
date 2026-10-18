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
import { ComparisonReadiness } from './ComparisonReadiness.tsx'
import { StagedStorePreview } from './StagedStorePreview.tsx'
import { stagedStoreFingerprint } from './stagedStoreFingerprint.ts'
import { LocalProductPicker } from './LocalProductPicker.tsx'
import { unresolvedProductGuidance } from './unresolvedProductGuidance.ts'
import { privateUnitPrice } from './privateUnitPrice.ts'
import './offlineReviewedWorkbench.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores = ['PLUS', 'DekaMarkt'] as const
const EMPTY_MANUAL_CHOICES: Readonly<Record<string, string>> = Object.freeze({})
const manualKey = (store: string, ingredientId: string) => store + '\u0000' + ingredientId
function captureDate(ms: number) { return dateTime.format(new Date(ms)) }

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
        const slug = need.label.normalize('NFKD').toLowerCase()
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54)
        const id = `own-${store === 'PLUS' ? 'plus' : 'deka'}-${index + 1}-${slug || 'ingredient'}`
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

  const {
    text, setText, imported, setImported, importEpoch, setImportEpoch,
    stagedCaptures: storedStages, setStagedCaptures,
    manualSelections, setManualSelections,
  } = session
  const [message, setMessage] = useState('')
  const [onlyUnresolved, setOnlyUnresolved] = useState<Record<OfflineRetailer, boolean>>({ PLUS: false, DekaMarkt: false })
  const [busy, setBusy] = useState(false)
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
    importVersion.current++
    setBusy(false)
    clearStaged()
    setImported(null)
    setText('')
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
    setImportEpoch(epoch => epoch + 1)
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
      // Never retain/display a previous basket after an invalid new import.
      setImported(null)
      setMessage(error instanceof Error ? error.message : 'Ongeldige import.')
      return false
    }
  }
  /** Paste is admitted through exactly the same local JSON/CSV adapters as
   * file upload, and never creates a missing retailer or relaxed price rule. */
  async function importPastedData() {
    const supplied = text
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
        importOneStore(json)
      } else if (importSnapshots(json)) {
        // Keep the original parsed captures as JSON, including null prices;
        // the raw pasted CSV is never confused with canonical JSON here.
        setText(json)
        clearStaged()
      }
    } catch (error) {
      if (version !== importVersion.current) return
      setImported(null)
      setMessage((error instanceof Error ? error.message : 'Deze brongegevens zijn ongeldig.') +
        ' Er wordt geen winkelprijs of prijsverschil uit dit concept afgeleid.')
    } finally {
      if (version === importVersion.current) setBusy(false)
    }
  }

  async function loadFile(file?: File) {
    if (!file) return
    const version = ++importVersion.current
    const previousImported = imported
    const previousText = text
    // Never leave an older basket, price difference or claim on screen while
    // a second local import is being read, converted or rejected.
    setImported(null)
    setBusy(true)
    setMessage('Bestand wordt alleen in deze browser verwerkt.')
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
          importOneStore(content)
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
        importOneStore(json)
        return
      }
      // A rejected replacement must not erase a previously accepted capture.
      // Defer stage clearing until the strict pair admission succeeds.
      setText(json)
      if (importSnapshots(json)) clearStaged()
      else {
        setText(previousText)
        setImported(previousImported)
      }
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
    if (files.length === 1) { await loadFile(files[0]); return }
    // Two independent captures can be selected together without ever treating
    // the first uploaded store as an admissible or priced two-store basket.
    const version = ++importVersion.current
    const previousImported = imported
    const previousText = text
    setImported(null)
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
      setText(combined)
      if (!importSnapshots(combined)) {
        setText(previousText)
        setImported(previousImported)
        return
      }
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

  /** A manually entered or uploaded replacement uses the SAME exact original
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
    setClockMs(Date.now())
    setImportEpoch(epoch => epoch + 1)
    setImported(parsed)
    setMessage(retailer + ' is vervangen. De andere originele winkelopname is onveranderd. ' +
      'Bestaande geldige koppelingen en extra artikelen van ' + other +
      ' zijn bewaard; beoordeel alleen de vernieuwde ' + retailer + '-producten opnieuw.' +
      (parsed.pairedWithin24h ? '' : ' De opnames liggen meer dan 24 uur uiteen: geen vergelijkbaar verschil.'))
  }

  async function replaceOneStoreFile(file?: File) {
    if (!file || !imported || !text) return
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
      applyStoreReplacement(json)
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
              try { applyStoreReplacement(json) }
              catch (error) {
                setMessage((error instanceof Error ? error.message : 'Kon deze winkel niet bijwerken.') +
                  ' Je eerder toegelaten winkelpaar is behouden.')
              }
            } else importOneStore(json)
          } else {
            // A new full pair is admitted atomically; a malformed update
            // leaves the current in-memory reviews and captures in place.
            const previousText = text
            const previousImported = imported
            setText(json)
            if (importSnapshots(json)) clearStaged()
            else {
              setText(previousText)
              setImported(previousImported)
            }
          }
        }}
        onEdit={() => {
          // A user editing the in-app wizard also invalidates a pending file read.
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
          <textarea rows={5} value={text} maxLength={256000} spellCheck={false}
            placeholder={'{"schema":"supa-offline-prices-v1","captures":[...]}'}
            onChange={event => {
              // A pending file read is no longer authoritative after manual edits.
              importVersion.current++
              setBusy(false)
              // Keep a previously admitted standalone store while the user
              // pastes its partner. Only a successfully admitted replacement
              // changes that source; invalid draft text has no price authority.
              if (imported) clearStaged()
              setText(event.target.value)
              setImported(null)
              setMessage(stagedStores.length > 0
                ? 'JSON-concept gewijzigd. Reeds ingelezen losse winkelopnames blijven bewaard; klik Importeer en bereken om een tweede opname toe te voegen.'
                : 'Invoer gewijzigd. Bereken opnieuw voordat mandjes en prijsverschillen zichtbaar zijn.')
            }} />
        </label>
        <div className="offline-price-workbench__actions">
          <button type="button" disabled={busy || !text.trim()} onClick={() => { void importPastedData() }}>
            {imported ? 'Herbereken mandjes' : 'Importeer en bereken'}
          </button>
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
              />
              <PrivateBasketComparisonExport
                plus={basketPair.plus}
                deka={basketPair.deka}
                plusObservedAt={imported.captures.PLUS.observedAt}
                dekaObservedAt={imported.captures.DekaMarkt.observedAt}
                comparable={canShowDifference}
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
