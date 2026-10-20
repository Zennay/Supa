import { lazy, Suspense, useEffect, useState } from 'react'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { PrivateReviewedTwoStoreTable } from './PrivateReviewedTwoStoreTable.tsx'
import { ownStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { productSearchText } from './productSearchText.ts'
import { privatePriceAgeNotice } from '../comparison/privatePriceAgeNotice.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'
import { freshReviewedBaskets, recentOwnCaptureInstant, privateReviewedPairWithin24Hours } from '../comparison/privateReviewedBasketBridge.ts'
import type { OwnStore, PrivateCaptureProgress, PrivateReviewedBaskets, PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import './privateReviewedProductCatalog.css'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const shops: OwnStore[] = ['PLUS', 'DekaMarkt']
const emptyReviewed: PrivateReviewedBaskets = { planKey: '', stores: {} }
type Matched = Extract<BasketTraceLine, { status: 'matched' }>
// Reuse the Planner's admitted partial-source rows and same-demand pairing.
// Its formatter never converts incomplete sources into whole-basket totals.
const PlannerReviewedSourceLines = lazy(async () => {
  const module = await import('../planner/PlannerReviewedSourceLines.tsx')
  return { default: module.PlannerReviewedSourceLines }
})
// Reuse the Planner's exact admitted offline CSV/TSV/JSON paste workflow.
// It previews original SKU and capture facts, then hands off to Vergelijk;
// no independent Products parser, price claim or permission is introduced.
const PlannerQuickSourcePaste = lazy(async () => {
  const module = await import('../planner/PlannerQuickSourcePaste.tsx')
  return { default: module.PlannerQuickSourcePaste }
})

/** Read-only personally reviewed basket sources, never an inferred live catalog. */
export function PrivateReviewedProductCatalog({ reviewed, progress, budget, onOpenComparison, onOpenList, onOpenMixedRoute, onChooseRouteLine, onReviewIngredient, onImportSourceFiles, fileWarning, checked, onToggleChecked }: {
  reviewed: PrivateReviewedBaskets | null
  progress: PrivateCaptureProgress | null
  budget: number
  onOpenComparison: () => void
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onImportSourceFiles: (files: File[]) => void
  fileWarning: string
  onOpenList: (store?: OwnStore) => void
  onOpenMixedRoute: () => void
  onChooseRouteLine: (choice: Omit<PrivateRouteChoice, 'serial'>) => void
  checked: Readonly<Record<string, boolean>>
  onToggleChecked: (shop: OwnStore, line: Matched) => void
}) {
  const [store, setStore] = useState<'all' | OwnStore>('all')
  const [query, setQuery] = useState('')
  const [unitFilter, setUnitFilter] = useState<'all' | 'kg' | 'liter' | 'stuk'>('all')
  const [order, setOrder] = useState<'source' | 'unitPrice' | 'lineTotal' | 'priceGap'>('source')
  const [checkMessage, setCheckMessage] = useState('')
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
  const gapById = new Map<string, number>(paired.status === 'comparable'
    ? paired.lines.map(line => [line.id, Math.abs(line.deltaCents)])
    : [])
  const search = productSearchText(query.trim())
  const rate = (line: Matched) => privatePackUnitRate({
    amount: line.pack.amount, unit: line.pack.unit, count: line.pack.count,
    priceCents: line.pricePerPackCents,
  })
  const visible = sources.filter(row =>
    (store === 'all' || row.shop === store) &&
    (unitFilter === 'all' || rate(row.line)?.unit === unitFilter) &&
    (!search || [row.line.productName, row.line.productId, row.line.ingredientLabel]
      .some(value => productSearchText(value).includes(search))))
  // Price/kg cannot meaningfully be compared to price/litre/piece. Keep
  // incompatible units in distinct stable groups; prices are advisory only,
  // while weekly whole-pack costs remain the authoritative budget calculation.
  const group = (line: Matched) =>
    ({ kg: 0, liter: 1, stuk: 2 } as Record<string, number>)[rate(line)?.unit ?? ''] ?? 3
  const ordered = order === 'source' || (order === 'priceGap' && paired.status !== 'comparable')
    ? visible : [...visible].sort((a, b) =>
    order === 'priceGap'
      ? (gapById.get(b.line.id) ?? -1) - (gapById.get(a.line.id) ?? -1)
      : order === 'lineTotal'
        ? a.line.lineTotalCents - b.line.lineTotalCents
      : group(a.line) - group(b.line) ||
        (rate(a.line)?.centsPerUnit ?? Infinity) - (rate(b.line)?.centsPerUnit ?? Infinity))
  const isChecked = (shop: OwnStore, line: Matched) => {
    const capture = currentReviewed?.stores[shop]
    return !!capture && checked[
      privatePhysicalShoppingTick(reviewed!.planKey, shop, capture.basket.store.id, line)] === true
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
  function openCurrentCheckedList() {
    // This action can be pressed after the seven-day price window expires.
    // Never navigate as though a stale source still certifies a priced list.
    const latest = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    const chosen = store === 'all'
      ? latest?.stores.PLUS ? 'PLUS' : latest?.stores.DekaMarkt ? 'DekaMarkt' : null
      : latest?.stores[store] ? store : null
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
    <Suspense fallback={<p role="status">Lokale broninvoer openen…</p>}>
      <PlannerQuickSourcePaste
        onImport={onImportSourceFiles}
        onRecapture={() => onOpenComparison()}
        onReviewIngredient={onReviewIngredient}
        hasDemand={true}
        needs={[]} />
    </Suspense>
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
    {currentProgress && !fullPairReady && <Suspense fallback={<p role="status">
      Bevestigde losse bronartikelen laden…</p>}>
      <PlannerReviewedSourceLines progress={currentProgress} now={nowMs}
        onOpenComparison={onOpenComparison} onReviewIngredient={onReviewIngredient}
        hasCompleteComparison={fullPairReady} />
    </Suspense>}
    {hasExpiredSource && <p role="status" className="private-reviewed-products__age">
      Eén of beide eerdere winkelopnames zijn verlopen of niet meer bruikbaar.
      De bijbehorende prijzen zijn verborgen. Herzie de originele bron in Vergelijk;
      je eerdere lijstvinkjes blijven bewaard.
    </p>}
    {!sources.length ? <p role="status">Nog geen complete en actuele eigen bronproducten beschikbaar.
      Kies een weekmenu, importeer je eigen winkelbron en controleer iedere SKU en verpakking.</p> : <>
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
            disabled={paired.status !== 'comparable'}>Grootste prijsverschil per ingrediënt</option>}
        </select></label>
        <label>Zoek eigen product <input type="search" value={query}
          onChange={event => setQuery(event.target.value)} maxLength={120} placeholder="Product, SKU of ingrediënt" /></label>
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
          return <section key={shop}>
            <h3>{shop}</h3>
            <p><strong>{done} van {lines.length}</strong> producten afgevinkt</p>
            <progress value={done} max={lines.length}
              aria-label={'Voortgang originele ' + shop + '-boodschappen'} />
            <strong>Nog op mijn lijst: {money.format(remaining / 100)}</strong>
            {privatePriceAgeNotice(capture.capturedMs, nowMs) && (
              <small role="status" className="private-reviewed-products__age">
                {privatePriceAgeNotice(capture.capturedMs, nowMs)}
              </small>
            )}
            <small>Oorspronkelijk volledig mandje: {
              money.format(capture.basket.totalCents / 100)}.
              Dit zijn nog niet-afgevinkte productbedragen, geen betaalbewijs.</small>
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
      {checkMessage && <p role="status">{checkMessage}</p>}
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
        <button type="button" className="private-reviewed-products__checked-action"
          aria-pressed={isChecked(shop, line)}
          onClick={() => toggleChecked(shop, line)}>
          {isChecked(shop, line) ? '✓ Afgevinkt · maak ongedaan' :
            'Vink dit artikel af op mijn ' + shop + '-lijst'}
        </button>
      </article>)}</div>
      {!visible.length && <p>Geen producten gevonden voor deze selectie.</p>}
      <button type="button" onClick={openCurrentCheckedList}>
        {store === 'all' ? 'Open mijn gecontroleerde boodschappenlijst' : `Open mijn ${store}-boodschappenlijst`}
      </button>
    </>}
    {store === 'all' && <PrivateReviewedTwoStoreTable reviewed={reviewed ?? emptyReviewed}
      search={search} unitFilter={unitFilter} order={order} budget={budget}
      onOpenComparison={onOpenComparison} onOpenList={onOpenList}
      onOpenMixedRoute={onOpenMixedRoute} onChooseRouteLine={onChooseRouteLine}
      checked={checked} />}
    <button type="button" onClick={onOpenComparison}>Open prijsinvoer en productmatching</button>
    <small>Ontbrekende of verlopen bronproducten krijgen nooit een verzonnen prijs.</small>
  </section>
}
