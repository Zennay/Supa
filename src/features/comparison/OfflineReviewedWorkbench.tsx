import { useEffect, useMemo, useRef, useState } from 'react'
import { aggregatePlanIngredients, buildOneStoreBasket, type RecipeWithIngredients, type BasketTraceLine } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, parseSingleOfflineCapture, type OfflinePriceSnapshots, type OfflineRetailer } from '../../domain/offlineReviewedImport.ts'
import { LocalTwoStorePriceEditor } from './LocalTwoStorePriceEditor.tsx'
import { PrivateStoreTripChecklist } from './PrivateStoreTripChecklist.tsx'
import { PrivateBasketComparisonExport } from './PrivateBasketComparisonExport.tsx'
import { LocalProductPicker } from './LocalProductPicker.tsx'
import './offlineReviewedWorkbench.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores = ['PLUS', 'DekaMarkt'] as const
type Matched = Extract<BasketTraceLine, { status: 'matched' }>
const EMPTY_MANUAL_CHOICES: Readonly<Record<string, string>> = Object.freeze({})
const manualKey = (store: string, ingredientId: string) => store + '\u0000' + ingredientId
function pricePerUnit(line: Matched): string | null {
  const { unit, amount, count } = line.pack
  const physical = amount * count
  const basis = unit === 'g' || unit === 'ml' ? physical / 1000 : physical
  if (!Number.isFinite(basis) || basis <= 0) return null
  const cents = line.pricePerPackCents / basis
  if (!Number.isFinite(cents) || cents < 0) return null
  return euros.format(cents / 100) + ' per ' +
    (unit === 'g' || unit === 'kg' ? 'kg' : unit === 'ml' || unit === 'l' ? 'liter' : 'stuk')
}
function captureDate(ms: number) { return dateTime.format(new Date(ms)) }

/** Independent opt-in local import. Never treats JSON as evidence of retailer licensing or physical verification. */
export function OfflineReviewedWorkbench({
  plan, recipes, activeDays,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
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

  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [importEpoch, setImportEpoch] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const importVersion = useRef(0)
  // User-supplied single-store observations stay in memory; a half-pair never
  // reaches matching, totals, clipboard or persistent browser storage.
  const stagedCaptures = useRef<Partial<Record<OfflineRetailer, Record<string, unknown>>>>({})
  const [stagedStores, setStagedStores] = useState<OfflineRetailer[]>([])
  function clearStaged() {
    stagedCaptures.current = {}
    setStagedStores([])
  }
  function importOneStore(content: string) {
    const { retailer, capture } = parseSingleOfflineCapture(content, Date.now())
    const next = { ...stagedCaptures.current, [retailer]: capture }
    stagedCaptures.current = next
    setStagedStores(stores.filter(store => !!next[store]))
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
    importSnapshots(joined)
  }

  // Prevent stale imports from appearing comparable after an open browser tab
  // crosses a 7-day boundary. Refresh only the UI clock, not source observations.
  const [manualSelections, setManualSelections] = useState<{
    fingerprint: string
    products: Record<string, string>
  }>({ fingerprint: '', products: {} })
  // Manual decisions belong to the exact imported products/prices and plan.
  // Older selection state cannot affect a newly uploaded or edited observation.
  const importFingerprint = useMemo(() => imported ? JSON.stringify([
    plan, activeDays,
    recipes.map(recipe => [recipe.id, recipe.ingredients]),
    ...stores.map(store => [
      imported.captures[store].observedAt,
      imported.captures[store].products,
    ]),
  ]) : '', [imported, plan, recipes, activeDays])
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

  function importSnapshots(input: string) {
    setImportEpoch(epoch => epoch + 1)
    try {
      const parsed = parseOfflinePriceSnapshots(input, Date.now())
      setClockMs(Date.now())
      setImported(parsed)
      setMessage('Twee privéopnames lokaal geladen; Supa heeft geen gegevens naar een server verstuurd.')
    } catch (error) {
      // Never retain/display a previous basket after an invalid new import.
      setImported(null)
      setMessage(error instanceof Error ? error.message : 'Ongeldige import.')
    }
  }
  async function loadFile(file?: File) {
    if (!file) return
    const version = ++importVersion.current
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
      clearStaged()
      setText(json)
      importSnapshots(json)
    } catch (error) {
      if (version !== importVersion.current) return
      setText('')
      setImported(null)
      setMessage(error instanceof Error ? error.message : 'Kon dit bestand niet lezen.')
    } finally {
      if (version === importVersion.current) setBusy(false)
    }
  }

  const basketPair = useMemo(() => {
    if (!imported) return null
    try {
      const userReviewed = (store: 'PLUS' | 'DekaMarkt') =>
        Object.fromEntries(Object.entries(choices)
          .filter(([key]) => key.startsWith(store + '\u0000'))
          .map(([key, productId]) => [key.slice(store.length + 1), productId]))
      const plus = buildOneStoreBasket({
        store: { id: 'PLUS', name: 'PLUS' }, plan, recipes, activeDays,
        products: imported.captures.PLUS.products,
        manualProductIds: userReviewed('PLUS'),
      })
      const deka = buildOneStoreBasket({
        store: { id: 'DekaMarkt', name: 'DekaMarkt' }, plan, recipes, activeDays,
        products: imported.captures.DekaMarkt.products,
        manualProductIds: userReviewed('DekaMarkt'),
      })
      return { plus, deka, comparison: compareFullBaskets({ baseline: plus, candidate: deka }) }
    } catch { return null }
  }, [imported, plan, recipes, activeDays, choices])
  const currentEnough = useMemo(() => {
    if (!imported) return false
    const nowNs = BigInt(Math.trunc(clockMs)) * 1000000n
    const first = imported.captures.PLUS.observedNs
    const second = imported.captures.DekaMarkt.observedNs
    const oldest = first < second ? first : second
    const newest = first > second ? first : second
    return nowNs >= newest - 300000000000n && nowNs - oldest <= 604800000000000n
  }, [imported, clockMs])
  const canShowDifference = !!imported && currentEnough && imported.pairedWithin24h &&
    !!basketPair?.comparison.claimable

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
        onGenerated={(json) => {
          importVersion.current++
          setBusy(false)
          clearStaged()
          setText(json)
          importSnapshots(json)
        }}
        onEdit={() => {
          // A user editing the in-app wizard also invalidates a pending file read.
          importVersion.current++
          setBusy(false)
          clearStaged()
          setImported(null)
          setMessage('Wijzigingen nog niet doorgerekend. Bereken opnieuw om de mandjes te zien.')
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
          Je mag ook twee aparte JSON-bestanden aanleveren. Gebruik dan per bestand
          <code>schema: "supa-offline-store-capture-v1"</code> en één <code>capture</code>
          met dezelfde velden als hierboven. Laad eerst de ene winkel en daarna de andere;
          beide opnames blijven alleen in het geheugen van deze pagina.
          Ontbrekende prijzen: zet <code>priceCents: null</code> en <code>available: false</code>.</p>
      </details>
      <div className="offline-price-workbench__input">
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
        <label>Importeer een gecombineerd bestand of twee losse winkelopnames vanaf dit apparaat
          <input type="file" accept=".json,.csv,application/json,text/csv" disabled={busy}
            onChange={event => { void loadFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
        </label>
        {stagedStores.length > 0 && <div className="offline-price-workbench__staged" role="status">
          <strong>Losse winkelopnames in geheugen:</strong> {stagedStores.join(' + ')}.
          {stagedStores.length === 1
            ? ' Upload nu de tweede winkel als JSON. Tot die tijd is geen totaal of verschil beschikbaar.'
            : ' Beide bestanden geladen; de bestaande regels bepalen of de prijzen vergelijkbaar zijn.'}
          <button type="button" className="ghost-button" onClick={() => {
            importVersion.current++
            clearStaged()
            setImported(null)
            setText('')
            setMessage('Beide losse winkelopnames uit dit scherm verwijderd.')
          }}>Wis losse opnames</button>
        </div>}
        <label>Of plak de twee winkelopnames als JSON
          <textarea rows={5} value={text} maxLength={256000} spellCheck={false}
            placeholder={'{"schema":"supa-offline-prices-v1","captures":[...]}'}
            onChange={event => {
              // A pending file read is no longer authoritative after manual edits.
              importVersion.current++
              setBusy(false)
              clearStaged()
              setText(event.target.value)
              setImported(null)
              setMessage('Invoer gewijzigd. Bereken opnieuw voordat mandjes en prijsverschillen zichtbaar zijn.')
            }} />
        </label>
        <div className="offline-price-workbench__actions">
          <button type="button" disabled={busy || !text.trim()} onClick={() => importSnapshots(text)}>
            Bereken mandjes
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
            importVersion.current++
            setBusy(false)
            clearStaged()
            setImported(null); setText(''); setMessage('Geïmporteerde prijsdata uit dit scherm gewist.')
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
                      <strong>{complete ? euros.format(basket.totalCents / 100) : 'Geen volledig totaal'}</strong>
                      {!complete && basket.matchedLineCount > 0 && (
                        <span>Bekende regels samen: {euros.format(basket.totalCents / 100)} (geen mandtotaal)</span>
                      )}
                      <span>{basket.matchedLineCount} gekoppeld, {basket.unresolvedLineCount} onbekend</span>
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
                      <p className="disclaimer">Kies een product alleen als je zelf hebt gecontroleerd
                        dat het werkelijk bij dit ingrediënt past. Supa gebruikt uitsluitend jouw
                        geïmporteerde producten, met bestaande verpakkings- en prijscontroles.
                        Een handmatige keuze is geen onafhankelijk supermarktbewijs.</p>
                      {basket.lines.map(line => (
                        <article key={line.id} className="offline-price-workbench__line">
                          <div>
                            <strong>{line.ingredientLabel}</strong>
                            <span>Benodigd: {line.requirement.amount ?? '?'} {line.requirement.unit}</span>
                            {line.status === 'matched' && <span>{line.productName} · {line.packs} × verpakking</span>}
                            {line.status === 'matched' && <span>Eenheidsprijs: {pricePerUnit(line) ?? 'onbekend'}</span>}
                            {line.status === 'unresolved' && <span>Niet gekoppeld · controleer bronproduct, beschikbaarheid of verpakking.</span>}
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
