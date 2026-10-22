import { useEffect, useState } from 'react'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { PrivateReviewedTwoStoreTable } from './PrivateReviewedTwoStoreTable.tsx'
import { ownStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { productSearchText } from './productSearchText.ts'
import { privatePriceAgeNotice } from '../comparison/privatePriceAgeNotice.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'
import { freshReviewedBaskets, recentOwnCaptureInstant } from '../comparison/privateReviewedBasketBridge.ts'
import type { OwnStore, PrivateReviewedBaskets, PrivateCaptureProgress, PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import './privateReviewedProductCatalog.css'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const shops: OwnStore[] = ['PLUS', 'DekaMarkt']
const emptyReviewed: PrivateReviewedBaskets = { planKey: '', stores: {} }
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** Read-only personally reviewed basket sources, never an inferred live catalog. */
export function PrivateReviewedProductCatalog({ reviewed, captureProgress, budget, onOpenComparison, onReviewIngredient, onOpenList, onOpenMixedRoute, onChooseRouteLine, checked, onToggleChecked }: {
  reviewed: PrivateReviewedBaskets | null
  captureProgress?: PrivateCaptureProgress | null
  onReviewIngredient?: (shop: OwnStore, ingredientId: string) => void
  budget: number
  onOpenComparison: () => void
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
  const [shoppingFilter, setShoppingFilter] = useState<'all' | 'open' | 'done'>('all')
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
  const sources = shops.flatMap(shop => {
    const capture = currentReviewed?.stores[shop]
    return capture ? capture.basket.lines.filter((line): line is Matched => line.status === 'matched')
      .map(line => ({ shop, line, observedAt: capture.observedAt })) : []
  })
  // Keep unpriced ingredient identities visible even if neither shop has a
  // single matched SKU: otherwise the user cannot tell which input is missing.
  const unmatchedWithoutPricedRows = shops.flatMap(shop => {
    const capture = currentReviewed?.stores[shop]
    return capture ? capture.basket.lines.filter(line => line.status === 'unresolved')
      .map(line => ({ shop, line })) : []
  })
  // One canonical physical basket comparison for the two-store cards too:
  // never rank a missing or unpaired price as if it were a valid difference.
  const paired = ownStoreWeekComparison(currentReviewed)
  // Never default a shopper to PLUS when the canonical whole-pack comparison
  // says DekaMarkt is cheaper. With two unpaired sources there is no winner.
  const oneStore = paired.available.length === 1 ? paired.available[0] : null
  const listSuggestion = paired.status === 'comparable'
    ? (paired.cheapest ?? 'PLUS') : oneStore
  const gapById = new Map<string, number>(paired.status === 'comparable'
    ? paired.lines.map(line => [line.id, Math.abs(line.deltaCents)])
    : [])
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
    (unitFilter === 'all' || rate(row.line)?.unit === unitFilter) &&
    (shoppingFilter === 'all' || (shoppingFilter === 'done') ===
      isChecked(row.shop, row.line)) &&
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
    // Recheck source age and same-physical-demand matching at click time.
    const latest = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    const comparison = ownStoreWeekComparison(latest)
    let chosen: OwnStore | null = null
    if (store !== 'all') {
      chosen = latest?.stores[store] ? store : null
    } else if (comparison.status === 'comparable') {
      chosen = comparison.cheapest ?? 'PLUS'
    } else if (comparison.available.length === 1) {
      chosen = comparison.available[0]
    } else if (comparison.available.length === 2) {
      setCheckMessage('Beide winkelbronnen zijn niet voor hetzelfde complete mandje ' +
        'vergelijkbaar. Kies expliciet PLUS of DekaMarkt om één lijst te openen.')
      return
    }
    if (!chosen) {
      setCheckMessage('Deze eigen bron is verlopen of gewijzigd. Controleer de originele winkelopname in Vergelijk.')
      return
    }
    setCheckMessage(store === 'all' && comparison.status === 'comparable'
      ? 'Open ' + chosen + ' op basis van de laagste oorspronkelijke hele-pakkentotaalprijs. ' +
        'Geen kassagarantie of bewezen netto besparing.'
      : 'Open je eigen gecontroleerde winkelmandje bij ' + chosen + '.')
    onOpenList(chosen)
  }
  return <section className="private-reviewed-products" aria-label="Mijn persoonlijk gecontroleerde winkelproducten">
    <h2>Mijn echte bronartikelen voor dit weekmenu</h2>
    <p>Alleen jouw zelf gecontroleerde productregels, geen actuele winkelcatalogus of kassagarantie.
      Historische ontwerpvoorbeelden elders op de pagina tellen niet mee.</p>
    {captureProgress && <section className="private-reviewed-products__capture-progress"
      aria-label="Bronproducten en nog te controleren ingrediënten">
      <h3>Mijn broninvoer en productmatching</h3>
      <p>Dit is voortgang van jouw lokaal ingevoerde bronbestanden, géén geprijsd totaal.
        Pas na een complete, verse en expliciet beoordeelde winkelbron kunnen bedragen
        in de vergelijking en het weekbudget meetellen.</p>
      <div className="private-reviewed-products__capture-grid">
        {shops.map(shop => {
          const source = captureProgress.stores[shop]
          const freshSource = !!source && recentOwnCaptureInstant(source.observedAt, nowMs)
          return <article key={shop}>
            <h4>{shop}</h4>
            {!source ? <p>Nog geen bronbestand voor deze winkel.</p> : <>
              <strong>{source.reviewedLineCount} van {source.demandLineCount} ingrediënten beoordeeld</strong>
              <progress value={Math.min(source.reviewedLineCount, source.demandLineCount)}
                max={Math.max(1, source.demandLineCount)}
                aria-label={'Beoordeelde eigen ingrediënten bij ' + shop} />
              <small>{source.originalProductCount} bronartikelen, waarvan {
                source.pricedProductCount} met originele bronprijs.</small>
              <small role="status">{freshSource
                ? 'Bronmoment binnen zeven dagen, nog geen bewijs van actuele kassaprijs.'
                : 'Bronmoment verlopen of niet bruikbaar: prijzen tellen niet als actueel.'}</small>
              {freshSource && !!source.confirmedSourceLines?.length && <details
                className="private-reviewed-products__confirmed-lines">
                <summary>{source.confirmedSourceLines.length} eigen beoordeelde bronregels met
                  oorspronkelijke verpakkingsprijzen bekijken</summary>
                <ul>{source.confirmedSourceLines.map(line => <li
                  key={line.ingredientId + ':' + line.productId}>
                  <strong>{line.ingredientLabel} → {line.productName}</strong>
                  <small>Originele SKU: {line.productId} · {line.packagesNeeded} hele
                    verpakking(en) van {line.packCount} × {line.packAmount} {line.packUnit}</small>
                  <small>Oorspronkelijke pakprijs: {money.format(line.pricePerPackCents / 100)}
                    {' '}· regelbedrag: {money.format(line.lineTotalCents / 100)}
                    {line.unitPrice ? ' · ' + line.unitPrice : ' · eenheidsprijs onbekend'}</small>
                  <small>{line.review === 'manual' ? 'Handmatig bevestigd' : 'Automatisch gekoppeld'};
                    geen volledig winkeltotaal of kassagarantie.</small>
                  <button type="button" disabled={!onReviewIngredient}
                    onClick={() => onReviewIngredient?.(shop, line.ingredientId)}>
                    Controleer originele SKU
                  </button>
                </li>)}</ul>
              </details>}
              {(source.missingIngredients.length > 0 || source.awaitingReviewIngredients.length > 0) &&
                <details className="private-reviewed-products__missing">
                  <summary>{source.missingIngredients.length} zonder betrouwbare match · {
                    source.awaitingReviewIngredients.length} nog te beoordelen</summary>
                  <ul>{[
                    ...source.missingIngredients.map(row => ({ ...row, reason: 'Geen productmatch of prijs' })),
                    ...source.awaitingReviewIngredients.map(row => ({ ...row, reason: 'Beoordeel originele SKU en verpakking' })),
                  ].map(row => <li key={row.reason + ':' + row.id}>
                    <strong>{row.label}</strong>
                    <span> · {row.amount === null || row.amount === undefined
                      ? 'hoeveelheid onbekend' : row.amount + ' ' + (row.unit ?? '')}
                      {' '}· {row.reason.toLowerCase()}</span>
                    <button type="button" disabled={!onReviewIngredient}
                      onClick={() => onReviewIngredient?.(shop, row.id)}>
                      Open in matching
                    </button>
                  </li>)}</ul>
                </details>}
              {source.missingIngredients.length === 0 && source.awaitingReviewIngredients.length === 0 &&
                <small>Geen openstaande matchcontrole in deze importvoortgang.</small>}
            </>}
            <button type="button" onClick={onOpenComparison}>
              {source ? 'Open eigen bron en review' : 'Voeg eigen winkelbron toe'}
            </button>
          </article>
        })}
      </div>
    </section>}
    {hasExpiredSource && <p role="status" className="private-reviewed-products__age">
      Eén of beide eerdere winkelopnames zijn verlopen of niet meer bruikbaar.
      De bijbehorende prijzen zijn verborgen. Herzie de originele bron in Vergelijk;
      je eerdere lijstvinkjes blijven bewaard.
    </p>}
    {!sources.length ? <div className="private-reviewed-products__missing-empty">
      <p role="status">Nog geen complete en actuele eigen bronproducten beschikbaar.
        Kies een weekmenu, importeer je eigen winkelbron en controleer iedere SKU en verpakking.</p>
      {unmatchedWithoutPricedRows.length > 0 && <details className="private-reviewed-products__missing">
        <summary>{unmatchedWithoutPricedRows.length} ingrediënten wachten nog op een betrouwbare productmatch of prijs</summary>
        <ul>{unmatchedWithoutPricedRows.map(({ shop, line }) => <li key={JSON.stringify([shop, line.id])}>
          <strong>{shop}: {line.ingredientLabel}</strong>
          <span> — {line.requirement.amount === null ? 'hoeveelheid onbekend'
            : line.requirement.amount + ' ' + line.requirement.unit} · bronprijs onbekend</span>
        </li>)}</ul>
        <button type="button" onClick={onOpenComparison}>Open mijn broninvoer en productmatching</button>
      </details>}
    </div> : <>
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
      <div role="group" className="private-reviewed-products__shopping-filter"
        aria-label="Filter eigen boodschappen op afvinkstatus">
        {([
          ['all', 'Alle originele artikelen'],
          ['open', 'Alleen nog te kopen'],
          ['done', 'Alleen afgevinkt'],
        ] as const).map(([value, label]) => <button type="button" key={value}
          aria-pressed={shoppingFilter === value}
          onClick={() => setShoppingFilter(value)}>{label}</button>)}
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
          const unresolved = capture.basket.lines.filter(line => line.status === 'unresolved')
          const complete = unresolved.length === 0 && lines.length > 0 &&
            capture.basket.unresolvedLineCount === 0
          const done = lines.filter(line => isChecked(shop, line)).length
          const remaining = lines.filter(line => !isChecked(shop, line))
            .reduce((sum, line) => sum + line.lineTotalCents, 0)
          return <section key={shop}>
            <h3>{shop}</h3>
            <p><strong>{done} van {lines.length}</strong> producten afgevinkt</p>
            <progress value={done} max={lines.length}
              aria-label={'Voortgang originele ' + shop + '-boodschappen'} />
            <strong>{complete ? 'Nog op mijn lijst' : 'Minimaal nog bekend op mijn lijst'}: {money.format(remaining / 100)}</strong>
            {!complete && <p role="status" className="private-reviewed-products__age">
              <strong>Totaal onbekend.</strong> {unresolved.length} van de {capture.basket.lines.length} fysieke
              ingrediënten hebben nog geen bevestigde productmatch, verpakking of bruikbare bronprijs.
              Bekende bedragen zijn geen complete weekmand en mogen niet met de andere winkel worden vergeleken.
            </p>}
            {unresolved.length > 0 && <details className="private-reviewed-products__missing">
              <summary>Welke {unresolved.length} ingrediënten missen een prijs of productmatch?</summary>
              <ul>{unresolved.map(line => <li key={line.id}>
                <strong>{line.ingredientLabel}</strong>
                <span> — {line.requirement.amount === null ? 'hoeveelheid onbekend'
                  : line.requirement.amount + ' ' + line.requirement.unit} · prijs onbekend</span>
              </li>)}</ul>
              <button type="button" onClick={onOpenComparison}>
                Controleer deze ingrediënten in prijsinvoer en productmatching
              </button>
            </details>}
            {privatePriceAgeNotice(capture.capturedMs, nowMs) && (
              <small role="status" className="private-reviewed-products__age">
                {privatePriceAgeNotice(capture.capturedMs, nowMs)}
              </small>
            )}
            <small>{complete ? 'Oorspronkelijk volledig mandje' : 'Bekend deel van de oorspronkelijke weekmand'}: {
              money.format(capture.basket.totalCents / 100)}.
              {complete ? ' Deze complete private bron blijft onderhevig aan geldigheid en broncontrole.' :
                ' Nog niet gematchte ingrediënten hebben geen bekende prijs; het volledige bedrag is onbekend.'}
              {' '}Dit is geen betaalbewijs.</small>
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
      {!visible.length && <p role="status">Geen producten gevonden voor deze selectie.
        {shoppingFilter !== 'all' && ' Schakel naar alle originele artikelen om de volledige lijst te zien.'}</p>}
      <button type="button" onClick={openCurrentCheckedList}>
        {store !== 'all' ? `Open mijn ${store}-boodschappenlijst`
          : paired.status === 'comparable'
            ? 'Open goedkoopste complete winkel (' + listSuggestion + ')'
            : listSuggestion
              ? 'Open beschikbare winkel (' + listSuggestion + ')'
              : 'Kies eerst een winkel voor de boodschappenlijst'}
      </button>
    </>}
    {store === 'all' && <PrivateReviewedTwoStoreTable reviewed={reviewed ?? emptyReviewed}
      search={search} unitFilter={unitFilter} order={order} budget={budget}
      onOpenComparison={onOpenComparison} onReviewIngredient={onReviewIngredient}
      onOpenList={onOpenList}
      onOpenMixedRoute={onOpenMixedRoute} onChooseRouteLine={onChooseRouteLine}
      checked={checked} />}
    <button type="button" onClick={onOpenComparison}>Open prijsinvoer en productmatching</button>
    <small>Ontbrekende of verlopen bronproducten krijgen nooit een verzonnen prijs.</small>
  </section>
}
