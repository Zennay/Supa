import { lazy, Suspense, useEffect, useState } from 'react'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { PrivateReviewedTwoStoreTable } from './PrivateReviewedTwoStoreTable.tsx'
import { ownStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { currentPrivateRouteChoice } from '../comparison/privateRouteChoice.ts'
import { productSearchText } from './productSearchText.ts'
import { privatePriceAgeNotice } from '../comparison/privatePriceAgeNotice.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { freshReviewedBaskets, recentOwnCaptureInstant, privateReviewedPairWithin24Hours, partialReviewedLinePairs } from '../comparison/privateReviewedBasketBridge.ts'
import type { OwnStore, PrivateCaptureProgress, PrivateReviewedBaskets, PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import './privateReviewedProductCatalog.css'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const shops: OwnStore[] = ['PLUS', 'DekaMarkt']
const emptyReviewed: PrivateReviewedBaskets = { planKey: '', stores: {} }
type Matched = Extract<BasketTraceLine, { status: 'matched' }>
// Individually admitted, incomplete product rows have their own browseable
// cards; they must not masquerade as complete store receipts.
const PrivatePartialProductCards = lazy(async () => {
  const module = await import('./PrivatePartialProductCards.tsx')
  return { default: module.PrivatePartialProductCards }
})
// Reuse exactly the Planner's current-physical-week missing-capture kit,
// including the offline CSV spreadsheet formats and matching row guide.
const PlannerMissingCapturePanel = lazy(async () => {
  const module = await import('../planner/PlannerMissingCapturePanel.tsx')
  return { default: module.PlannerMissingCapturePanel }
})
// Reuse the Planner's exact admitted offline CSV/TSV/JSON paste workflow.
// It previews original SKU and capture facts, then hands off to Vergelijk;
// no independent Products parser, price claim or permission is introduced.
const PlannerQuickSourcePaste = lazy(async () => {
  const module = await import('../planner/PlannerQuickSourcePaste.tsx')
  return { default: module.PlannerQuickSourcePaste }
})

/** Read-only personally reviewed basket sources, never an inferred live catalog. */
export function PrivateReviewedProductCatalog({ reviewed, progress, captureNeeds, budget, onOpenComparison, onOpenList, onOpenMixedRoute, onChooseRouteLine, onReviewIngredient, onAddMissingToOwnList, onImportSourceFiles, fileWarning, checked, onToggleChecked, onMarkCheckedBatch }: {
  reviewed: PrivateReviewedBaskets | null
  progress: PrivateCaptureProgress | null
  captureNeeds: readonly PlannerCaptureGuideNeed[]
  budget: number
  onOpenComparison: () => void
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onAddMissingToOwnList: (store: OwnStore, ingredients: readonly {id: string; label: string}[]) => string | null
  onImportSourceFiles: (files: File[]) => void
  fileWarning: string
  onOpenList: (store?: OwnStore) => void
  onOpenMixedRoute: () => void
  onChooseRouteLine: (choice: Omit<PrivateRouteChoice, 'serial'>) => void
  checked: Readonly<Record<string, boolean>>
  onToggleChecked: (shop: OwnStore, line: Matched) => void
  onMarkCheckedBatch: (shop: OwnStore, lines: readonly Matched[]) => string | null
}) {
  const [store, setStore] = useState<'all' | OwnStore>('all')
  const [query, setQuery] = useState('')
  const [onlyUnbought, setOnlyUnbought] = useState(false)
  const [unitFilter, setUnitFilter] = useState<'all' | 'kg' | 'liter' | 'stuk'>('all')
  const [order, setOrder] = useState<'source' | 'unitPrice' | 'lineTotal' | 'priceGap'>('source')
  const [checkMessage, setCheckMessage] = useState('')
  const [showPasteSource, setShowPasteSource] = useState(false)
  const [expandedMatchShop, setExpandedMatchShop] = useState<OwnStore | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setNowMs(Date.now())
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  // A product tile must never outlive its original seven-day source
  // admission. Recheck whenever the tab wakes up and at minute boundaries.
  // Keep the raw receipt untouched so renewed evidence can be reviewed.
  const currentReviewed = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', nowMs)
  const hasExpiredSource = shops.some(shop =>
    !!reviewed?.stores[shop] && !currentReviewed?.stores[shop])
  const fullPlus = currentReviewed?.stores.PLUS
  const fullDeka = currentReviewed?.stores.DekaMarkt
  const fullPairReady = !!fullPlus && !!fullDeka &&
    privateReviewedPairWithin24Hours(fullPlus, fullDeka) &&
    compareFullBaskets({ baseline: fullPlus.basket, candidate: fullDeka.basket }).claimable
  // Partial observations are guidance; they are NEVER complete priced baskets.
  // The parent passes progress scoped to exactly the current physical week.
  const currentProgress = progress?.planKey === reviewed?.planKey || !reviewed
    ? progress : null
  const sources = shops.flatMap(shop => {
    const capture = currentReviewed?.stores[shop]
    return capture ? capture.basket.lines.filter((line): line is Matched => line.status === 'matched')
      .map(line => ({ shop, line, observedAt: capture.observedAt })) : []
  })
  // One canonical physical basket comparison for the two-store cards too:
  // never rank a missing or unpaired price as if it were a valid difference.
  const paired = ownStoreWeekComparison(currentReviewed)
  // Individual original whole-pack prices can be compared even when another
  // ingredient is unresolved. Never treat this as a complete-basket winner.
  const partialPairs = paired.status === 'comparable' ? [] :
    partialReviewedLinePairs(fullPlus, fullDeka)
  const canCompareIndividualLines = paired.status === 'comparable' || partialPairs.length > 0
  const signedDeltaById = new Map<string, number>(paired.status === 'comparable'
    ? paired.lines.map(line => [line.id, line.deltaCents])
    : [])
  const visibleDeltaById = paired.status === 'comparable' ? signedDeltaById :
    new Map(partialPairs.map(({ plus, deka }) =>
      [plus.id, deka.lineTotalCents - plus.lineTotalCents]))
  const gapById = new Map([...visibleDeltaById].map(([id, delta]) => [id, Math.abs(delta)]))
  function priceDifferenceForProduct(shop: OwnStore, line: Matched): string | null {
    const delta = visibleDeltaById.get(line.id)
    if (delta === undefined) return null
    const scope = paired.status === 'comparable' ? '' :
      ' voor dit ene ingrediënt; totaal weekmandje onbekend'
    if (delta === 0) return 'Zelfde hele-verpakkingenprijs bij PLUS en DekaMarkt' + scope + '.'
    const against = shop === 'PLUS' ? 'DekaMarkt' : 'PLUS'
    const ownMinusOther = shop === 'PLUS' ? -delta : delta
    return money.format(Math.abs(ownMinusOther) / 100) +
      (ownMinusOther < 0 ? ' goedkoper dan bij ' : ' duurder dan bij ') +
      against + ' voor exact dezelfde fysieke ingrediëntvraag' + scope + '.'
  }
  const search = productSearchText(query.trim())
  const rate = (line: Matched) => privatePackUnitRate({
    amount: line.pack.amount, unit: line.pack.unit, count: line.pack.count,
    priceCents: line.pricePerPackCents,
  })
  const isChecked = (shop: OwnStore, line: Matched) => {
    const capture = currentReviewed?.stores[shop]
    return !!capture && checked[
      privatePhysicalShoppingTick(reviewed!.planKey, shop, capture.basket.store.id, line)] === true
  }
  const visible = sources.filter(row =>
    (store === 'all' || row.shop === store) &&
    (!onlyUnbought || !isChecked(row.shop, row.line)) &&
    (unitFilter === 'all' || rate(row.line)?.unit === unitFilter) &&
    (!search || [row.line.productName, row.line.productId, row.line.ingredientLabel]
      .some(value => productSearchText(value).includes(search))))
  // Price/kg cannot meaningfully be compared to price/litre/piece. Keep
  // incompatible units in distinct stable groups; prices are advisory only,
  // while weekly whole-pack costs remain the authoritative budget calculation.
  const group = (line: Matched) =>
    ({ kg: 0, liter: 1, stuk: 2 } as Record<string, number>)[rate(line)?.unit ?? ''] ?? 3
  const ordered = order === 'source' || (order === 'priceGap' && !canCompareIndividualLines)
    ? visible : [...visible].sort((a, b) =>
    order === 'priceGap'
      ? (gapById.get(b.line.id) ?? -1) - (gapById.get(a.line.id) ?? -1)
      : order === 'lineTotal'
        ? a.line.lineTotalCents - b.line.lineTotalCents
      : group(a.line) - group(b.line) ||
        (rate(a.line)?.centsPerUnit ?? Infinity) - (rate(b.line)?.centsPerUnit ?? Infinity))
  function chooseProductInRoute(shop: OwnStore, line: Matched) {
    // Do not promote a newly replaced SKU merely because its ingredient ID
    // coincides with the older visible card. The ORIGINAL card row is required.
    const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    const capture = current?.stores[shop]
    const intent = capture?.basket.lines.includes(line)
      ? currentPrivateRouteChoice(reviewed, line.id, shop, Date.now())
      : null
    if (!intent) {
      setCheckMessage('De eigen winkelbronnen zijn verlopen of niet vergelijkbaar. ' +
        'Herzie de originele bronnen voordat je een winkel kiest.')
      return
    }
    onChooseRouteLine(intent)
  }
  const toggleChecked = (shop: OwnStore, line: Matched) => {
    const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    if (!current?.stores[shop] || !current.stores[shop].basket.lines.includes(line)) {
      setCheckMessage('Deze originele winkelbron is verlopen of gewijzigd. Controleer de bron opnieuw.')
      return
    }
    onToggleChecked(shop, line)
    setCheckMessage('Het fysieke vinkje is voor ' + shop +
      ' aangepast. Dit is geen goedkeuring van de prijs of betaalbevestiging.')
  }
  function markVisibleUnbought() {
    if (store === 'all') {
      setCheckMessage('Kies eerst één winkel: een afvinking hoort bij fysieke PLUS- of DekaMarkt-producten.')
      return
    }
    const pending = ordered.filter(row => row.shop === store &&
      !isChecked(row.shop, row.line)).map(row => row.line)
    if (!pending.length || pending.length > 100) {
      setCheckMessage('Er zijn geen openstaande producten in deze selectie.')
      return
    }
    if (!window.confirm('Vink ' + pending.length + ' zichtbaar openstaande ' + store +
      '-artikelen af? Dit is alleen je tijdelijke winkellijst: geen betaling, productreview of prijsclaim.')) return
    const message = onMarkCheckedBatch(store, pending)
    setCheckMessage(message ?? 'De zichtbare ' + store +
      '-artikelen zijn afgevinkt. Je originele prijsopname blijft ongewijzigd.')
  }
  function openCurrentCheckedList() {
    // This action can be pressed after the seven-day price window expires.
    // Never navigate as though a stale source still certifies a priced list.
    const latest = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    const comparison = ownStoreWeekComparison(latest)
    let chosen: OwnStore | null = null
    if (store !== 'all') chosen = latest?.stores[store] ? store : null
    else if (comparison.status === 'comparable') chosen = comparison.cheapest
    else if (comparison.available.length === 1) chosen = comparison.available[0]
    if (!chosen && comparison.available.length === 2) {
      setCheckMessage('Er is geen eenduidig goedkoopste winkelmandje. Kies PLUS of DekaMarkt expliciet om één lijst te openen.')
      return
    }
    if (!chosen) {
      setCheckMessage('Deze eigen bron is verlopen of gewijzigd. Controleer de originele winkelopname in Vergelijk.')
      return
    }
    onOpenList(chosen)
  }
  return <section className="private-reviewed-products" aria-label="Mijn persoonlijk gecontroleerde winkelproducten">
    <h2>Mijn echte bronartikelen voor dit weekmenu</h2>
    <p>Alleen jouw zelf gecontroleerde productregels, geen actuele winkelcatalogus of kassagarantie.
      Historische ontwerpvoorbeelden elders op de pagina tellen niet mee.</p>
    <label className="private-reviewed-products__own-upload">
      <strong>Eigen PLUS/DekaMarkt-productbron openen</strong>
      <span>1–2 rechtmatig verkregen CSV-, TSV-, TXT- of Supa JSON-bestanden.
        De bestaande Vergelijk-importer controleert de originele SKU, verpakking,
        bronmoment en prijs en vraagt je om bevestiging.</span>
      <input type="file" multiple
        accept=".csv,.tsv,.txt,.json,text/csv,text/plain,text/tab-separated-values,application/json"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length) onImportSourceFiles(files)
        }} />
    </label>
    {fileWarning && <p role="alert" className="private-reviewed-products__upload-error">{fileWarning}</p>}
    <div className="private-reviewed-products__paste-access">
      <button type="button" aria-expanded={showPasteSource}
        onClick={() => setShowPasteSource(open => !open)}>
        {showPasteSource ? 'Sluit eigen spreadsheet-plakimport' :
          'Plak PLUS/Deka-winkelprijzen uit een spreadsheet of JSON'}
      </button>
      <small>Eigen bronproducten worden eerst lokaal gecontroleerd. De bestaande
        Vergelijk-import vraagt daarna om echte productmatching en bevestiging.</small>
    </div>
    {showPasteSource && <Suspense fallback={<p role="status">Lokale broninvoer openen…</p>}>
      <PlannerQuickSourcePaste
        initiallyOpen
        onImport={onImportSourceFiles}
        onRecapture={() => onOpenComparison()}
        onReviewIngredient={onReviewIngredient}
        hasDemand={captureNeeds.length > 0}
        needs={captureNeeds} />
    </Suspense>}
    <div className="private-reviewed-products__pending" aria-label="Brondekking en openstaande productmatches">
      {shops.map(shop => {
        const full = currentReviewed?.stores[shop]
        const partial = currentProgress?.stores[shop]
        const recent = !!partial && partial.fresh &&
          recentOwnCaptureInstant(partial.observedAt, nowMs)
        const total = full?.basket.lines.length ?? partial?.demandLineCount ?? 0
        const approved = full ? total : recent ? Math.min(total, partial!.reviewedLineCount) : 0
        const missing = recent ? partial?.missingIngredients ?? [] : []
        const pending = recent ? partial?.awaitingReviewIngredients ?? [] : []
        const next = recent ? (pending[0] ?? missing[0]) : null
        const queued = [...pending.map(item => ({ ...item, task: 'Te beoordelen' })),
          ...missing.map(item => ({ ...item, task: 'Ontbrekende bronprijs' }))]
          .filter((item, index, all) => all.findIndex(row => row.id === item.id) === index)
        const visibleQueued = expandedMatchShop === shop ? queued : queued.slice(0, 4)
        return <article key={shop}>
          <header><h3>{shop}</h3><span>{full ? 'Volledig gecontroleerd'
            : partial && !recent ? 'Opname vernieuwen'
              : partial ? 'Nog niet compleet' : 'Nog geen bron'}</span></header>
          {total > 0 && <>
            <progress value={Math.max(0, approved)} max={total}
              aria-label={shop + ': gecontroleerde ingrediënten'} />
            <small>{approved} van {total} ingrediëntregels gecontroleerd</small>
          </>}
          {full ? <p>Dit volledige mandje staat hieronder met oorspronkelijke
            hele-verpakkingsprijzen en eenheidsprijzen.</p>
            : partial && recent ? <>
              <p>{missing.length} ontbreken; {pending.length} vragen review.
                Zonder volledig mandje blijft het prijsverschil onbekend.</p>
              {next && <p><strong>Volgend product:</strong> {next.label}</p>}
              {missing.length > 0 && <div className="private-reviewed-products__missing-transfer">
                <p>Je kunt de ontbrekende fysieke ingrediënten alvast als <strong>ongeprijsde</strong>
                  boodschappen meenemen, zonder SKU, prijs of winkelgoedkeuring over te dragen.</p>
                <button type="button" onClick={() => {
                  if (!recentOwnCaptureInstant(partial!.observedAt, Date.now())) {
                    setCheckMessage('De bron is verlopen; controleer je oorspronkelijke opname opnieuw.')
                    return
                  }
                  const message = onAddMissingToOwnList(shop, missing.map(item =>
                    ({ id: item.id, label: item.label })))
                  if (message) setCheckMessage(message)
                }}>
                  Zet {missing.length} ontbrekende {shop}-ingrediënten op mijn ongeprijsde Lijst
                </button>
              </div>}
              {queued.length > 0 && <div className="private-reviewed-products__match-queue">
                <strong>Openstaande productmatching · {queued.length} unieke ingrediënten</strong>
                <ul>{visibleQueued.map(item => <li key={item.id}>
                  <div><strong>{item.label}</strong>
                    <small>{item.task} · {item.amount ?? 'hoeveelheid onbekend'} {item.unit ?? ''}</small>
                  </div>
                  <button type="button" onClick={() => {
                    // The cached queue is only a navigation aid. Expired
                    // observations never authorize new prices or a review.
                    if (!recentOwnCaptureInstant(partial!.observedAt, Date.now())) {
                      setCheckMessage('De eigen bron van ' + shop +
                        ' is verlopen. Open Vergelijk voor een nieuwe opname.')
                      onOpenComparison()
                      return
                    }
                    onReviewIngredient(shop, item.id)
                  }}>Controleer dit artikel</button>
                  {item.task === 'Ontbrekende bronprijs' && <button type="button" onClick={() => {
                    if (!recentOwnCaptureInstant(partial!.observedAt, Date.now())) {
                      setCheckMessage('Bronopname verlopen; herzie het oorspronkelijke product.')
                      return
                    }
                    const message = onAddMissingToOwnList(shop, [{ id: item.id, label: item.label }])
                    if (message) setCheckMessage(message)
                  }}>Bewaar alleen dit ingrediënt ongeprijsd op Lijst</button>}
                </li>)}</ul>
                {queued.length > 4 && <button type="button"
                  aria-expanded={expandedMatchShop === shop}
                  onClick={() => setExpandedMatchShop(old => old === shop ? null : shop)}>
                  {expandedMatchShop === shop ? 'Toon minder' :
                    'Toon alle ' + queued.length + ' openstaande artikelen'}
                </button>}
              </div>}
            </> : <p>Geen actuele, volledige prijsdekking. Bedragen blijven onbekend.</p>}
          <button type="button" onClick={() => {
            // A tab wake-up cannot reuse an expired approval as live evidence.
            if (next && recentOwnCaptureInstant(partial!.observedAt, Date.now()))
              onReviewIngredient(shop, next.id)
            else onOpenComparison()
          }}>{next ? 'Controleer volgend product' : full
            ? 'Bekijk bronproducten' : 'Open broninvoer'}</button>
        </article>
      })}
    </div>
    {captureNeeds.length > 0 && !fullPairReady && <Suspense fallback={
      <p role="status">Gerichte opnamebladen voor ontbrekende winkelproducten laden…</p>}>
      <PlannerMissingCapturePanel captureNeeds={captureNeeds}
        captureProgress={currentProgress} reviewed={currentReviewed} now={nowMs}
        onOpenComparison={onOpenComparison} />
    </Suspense>}
    {currentProgress && !fullPairReady && <Suspense fallback={<p role="status">
      Bevestigde losse bronartikelen laden…</p>}>
      <PrivatePartialProductCards progress={currentProgress} reviewed={currentReviewed}
        now={nowMs} onOpenComparison={onOpenComparison}
        onReviewIngredient={onReviewIngredient} />
    </Suspense>}
    {hasExpiredSource && <p role="status" className="private-reviewed-products__age">
      Eén of beide eerdere winkelopnames zijn verlopen of niet meer bruikbaar.
      De bijbehorende prijzen zijn verborgen. Herzie de originele bron in Vergelijk;
      je eerdere lijstvinkjes blijven bewaard.
    </p>}
    {!sources.length ? <p role="status">Er is nog geen volledig geprijsd winkelmandje.
      De al bevestigde losse bronartikelen staan hierboven wanneer beschikbaar.
      Controleer de ontbrekende SKU’s in Vergelijk; verzin geen prijzen.</p> : <>
      <div className="private-reviewed-products__controls">
        <label>Winkel <select value={store} onChange={event => {
          const next = event.target.value as 'all' | OwnStore
          setStore(next)
          if (next !== 'all' && order === 'priceGap') setOrder('source')
        }}>
          <option value="all">Beide winkels</option>
          {shops.map(shop => <option value={shop} key={shop}>{shop}</option>)}
        </select></label>
        <label>Eenheid <select value={unitFilter}
          onChange={event => setUnitFilter(event.target.value as typeof unitFilter)}>
          <option value="all">Alle eenheden</option>
          <option value="kg">Prijs per kg</option>
          <option value="liter">Prijs per liter</option>
          <option value="stuk">Prijs per stuk</option>
        </select></label>
        <label>Sortering <select value={order}
          onChange={event => setOrder(event.target.value as typeof order)}>
          <option value="source">Oorspronkelijke bronvolgorde</option>
          <option value="unitPrice">Eenheidsprijs laag naar hoog</option>
          <option value="lineTotal">Weekregelbedrag laag naar hoog</option>
          {store === 'all' && <option value="priceGap"
            disabled={!canCompareIndividualLines}>Grootste bekende hele-pakprijsverschil</option>}
        </select></label>
        <label>Zoek eigen product <input type="search" value={query}
          onChange={event => setQuery(event.target.value)} maxLength={120} placeholder="Product, SKU of ingrediënt" /></label>
        <label className="private-reviewed-products__open-filter">
          <input type="checkbox" checked={onlyUnbought}
            onChange={event => setOnlyUnbought(event.currentTarget.checked)} />
          Alleen nog te kopen originele artikelen
        </label>
      </div>
      <div className="private-reviewed-products__bulk-shopping">
        <p role="status">{ordered.length} passende winkelartikelen zichtbaar.
          {' '}De volledige mandprijs wordt niet gefilterd.</p>
        {store !== 'all' && <button type="button" className="ghost-button"
          disabled={!ordered.some(row => !isChecked(row.shop, row.line))}
          onClick={markVisibleUnbought}>
          Vink {ordered.filter(row => !isChecked(row.shop, row.line)).length}
          {' '}openstaande {store}-artikelen af
        </button>}
        <small>Alleen fysieke winkellijst-vinkjes voor een gekozen winkel.
          Bronprijzen, oorspronkelijke SKU’s en menselijke productreviews blijven intact.</small>
      </div>
      <div className="private-reviewed-products__progress" aria-label="Mijn nog te kopen artikelen per winkel">
        {shops.filter(shop => store === 'all' || store === shop).map(shop => {
          const capture = currentReviewed?.stores[shop]
          if (!capture) return <section key={shop}>
            <h3>{shop}</h3><strong>Prijs onbekend</strong>
            <small>Geen volledige, actuele en persoonlijk gecontroleerde bron.</small>
            <button type="button" onClick={onOpenComparison}>Open broninvoer</button>
          </section>
          const lines = capture.basket.lines.filter((line): line is Matched =>
            line.status === 'matched')
          const done = lines.filter(line => isChecked(shop, line)).length
          const remaining = lines.filter(line => !isChecked(shop, line))
            .reduce((sum, line) => sum + line.lineTotalCents, 0)
          const unresolved = capture.basket.lines.filter(line => line.status === 'unresolved')
          const complete = unresolved.length === 0 && lines.length > 0 &&
            capture.basket.unresolvedLineCount === 0 &&
            capture.basket.matchedLineCount === capture.basket.lines.length
          return <section key={shop}>
            <h3>{shop}</h3>
            <p><strong>{done} van {lines.length}</strong> producten afgevinkt</p>
            <progress value={done} max={lines.length}
              aria-label={'Voortgang originele ' + shop + '-boodschappen'} />
            <strong>{complete ? 'Nog op mijn lijst' : 'Bekende nog te kopen pakprijzen'}:
              {' '}{money.format(remaining / 100)}</strong>
            {!complete && <p role="status" className="private-reviewed-products__age">
              <strong>Volledige mandprijs onbekend.</strong>
              {' '}{unresolved.length} van {capture.basket.lines.length} fysieke
              ingrediënten hebben nog geen bevestigde prijs of productmatch.
              De som hierboven omvat uitsluitend al bekende hele verpakkingen.
            </p>}
            {privatePriceAgeNotice(capture.capturedMs, nowMs) && (
              <small role="status" className="private-reviewed-products__age">
                {privatePriceAgeNotice(capture.capturedMs, nowMs)}
              </small>
            )}
            <small>{complete ? 'Oorspronkelijk volledig mandje' : 'Oorspronkelijk bekend geprijsd deel'}:
              {' '}{money.format(capture.basket.totalCents / 100)}.
              {complete ? ' Volledig volgens jouw gecontroleerde eigen bron.' :
                ' Andere ingrediënten hebben nog geen prijs; dit is geen mandtotaal.'}
              {' '}Geen betaalbewijs.</small>
            <button type="button" onClick={() => {
              const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
              if (current?.stores[shop] !== capture) {
                setCheckMessage('Deze eigen bron is verlopen. Open Vergelijk om je prijzen te herzien.')
                return
              }
              onOpenList(shop)
            }}>Open mijn {shop}-lijst</button>
          </section>
        })}
      </div>
      <p role="status">{visible.length} van {sources.length} bevestigde productregels.
        {' '}{ordered.filter(row => isChecked(row.shop, row.line)).length}
        {' '}van de getoonde artikelen staan op afgevinkt in je lijst.</p>
      {order === 'unitPrice' && unitFilter === 'all' && <p className="private-reviewed-products__sort-note">
        Eerst per kg, dan per liter en per stuk gesorteerd; verschillende eenheden
        worden niet met elkaar vergeleken. Voor het mandje tellen hele verpakkingen.
      </p>}
      <div className="private-reviewed-products__grid">{ordered.map(({ shop, line, observedAt }) => <article
        key={JSON.stringify([shop, line.id, line.productId])}>
        <small>{shop} · opname {observedAt}</small><h3>{line.productName}</h3>
        <small>Broncode {line.productId}</small>
        <p>{line.ingredientLabel}: {line.requirement.amount} {line.requirement.unit} nodig.</p>
        <p>{line.packs} × verpakking van {line.pack.count} × {line.pack.amount} {line.pack.unit}</p>
        <strong>{money.format(line.lineTotalCents / 100)} voor de week</strong>
        <small>{money.format(line.pricePerPackCents / 100)} per verpakking · {privateUnitPrice(line) ?? 'Eenheidsprijs onbekend'}</small>
        {priceDifferenceForProduct(shop, line) && <p className="private-reviewed-products__card-difference">
          {priceDifferenceForProduct(shop, line)}
        </p>}
        {signedDeltaById.has(line.id) && <button type="button"
          className="private-reviewed-products__route-choice"
          onClick={() => chooseProductInRoute(shop, line)}>
          Kies dit {shop}-artikel voor mijn gecombineerde route
        </button>}
        <button type="button" className="private-reviewed-products__checked-action"
          aria-pressed={isChecked(shop, line)}
          onClick={() => toggleChecked(shop, line)}>
          {isChecked(shop, line) ? '✓ Afgevinkt · maak ongedaan' :
            'Vink dit artikel af op mijn ' + shop + '-lijst'}
        </button>
      </article>)}</div>
      {!visible.length && <p>Geen producten gevonden voor deze selectie.</p>}
      <button type="button" onClick={openCurrentCheckedList}>
        {store !== 'all' ? `Open mijn ${store}-boodschappenlijst`
          : paired.status === 'comparable' && paired.cheapest
            ? 'Open goedkoopste complete winkel (' + paired.cheapest + ')'
            : paired.status === 'comparable' ? 'Gelijke prijs · kies eerst een winkel'
              : paired.available.length === 1
                ? 'Open beschikbare winkel (' + paired.available[0] + ')'
                : 'Kies eerst één winkel voor de boodschappenlijst'}
      </button>
    </>}
    {store === 'all' && <PrivateReviewedTwoStoreTable reviewed={reviewed ?? emptyReviewed}
      search={search} unitFilter={unitFilter} order={order} budget={budget}
      onOpenComparison={onOpenComparison} onReviewIngredient={onReviewIngredient}
      onOpenList={onOpenList}
      onOpenMixedRoute={onOpenMixedRoute} onChooseRouteLine={onChooseRouteLine}
      checked={checked} onlyUnbought={onlyUnbought} />}
    {checkMessage && <p role="status">{checkMessage}</p>}
    <button type="button" onClick={onOpenComparison}>Open prijsinvoer en productmatching</button>
    <small>Ontbrekende of verlopen bronproducten krijgen nooit een verzonnen prijs.</small>
  </section>
}
