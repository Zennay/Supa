import { useState } from 'react'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { PrivateReviewedTwoStoreTable } from './PrivateReviewedTwoStoreTable.tsx'
import { privatePriceAgeNotice } from '../comparison/privatePriceAgeNotice.ts'
import { privatePhysicalShoppingTick } from '../shopping-list/privatePhysicalShoppingTick.ts'
import { freshReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import type { OwnStore, PrivateReviewedBaskets, PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import './privateReviewedProductCatalog.css'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const shops: OwnStore[] = ['PLUS', 'DekaMarkt']
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** Read-only personally reviewed basket sources, never an inferred live catalog. */
export function PrivateReviewedProductCatalog({ reviewed, budget, onOpenComparison, onOpenList, onOpenMixedRoute, onChooseRouteLine, checked, onToggleChecked }: {
  reviewed: PrivateReviewedBaskets | null
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
  const [order, setOrder] = useState<'source' | 'unitPrice' | 'lineTotal'>('source')
  const [checkMessage, setCheckMessage] = useState('')
  const sources = shops.flatMap(shop => {
    const capture = reviewed?.stores[shop]
    return capture ? capture.basket.lines.filter((line): line is Matched => line.status === 'matched')
      .map(line => ({ shop, line, observedAt: capture.observedAt })) : []
  })
  const search = query.trim().toLocaleLowerCase('nl')
  const rate = (line: Matched) => privatePackUnitRate({
    amount: line.pack.amount, unit: line.pack.unit, count: line.pack.count,
    priceCents: line.pricePerPackCents,
  })
  const visible = sources.filter(row =>
    (store === 'all' || row.shop === store) &&
    (unitFilter === 'all' || rate(row.line)?.unit === unitFilter) &&
    (!search || [row.line.productName, row.line.productId, row.line.ingredientLabel]
      .some(value => value.toLocaleLowerCase('nl').includes(search))))
  // Price/kg cannot meaningfully be compared to price/litre/piece. Keep
  // incompatible units in distinct stable groups; prices are advisory only,
  // while weekly whole-pack costs remain the authoritative budget calculation.
  const group = (line: Matched) =>
    ({ kg: 0, liter: 1, stuk: 2 } as Record<string, number>)[rate(line)?.unit ?? ''] ?? 3
  const ordered = order === 'source' ? visible : [...visible].sort((a, b) =>
    order === 'lineTotal'
      ? a.line.lineTotalCents - b.line.lineTotalCents
      : group(a.line) - group(b.line) ||
        (rate(a.line)?.centsPerUnit ?? Infinity) - (rate(b.line)?.centsPerUnit ?? Infinity))
  const isChecked = (shop: OwnStore, line: Matched) => {
    const capture = reviewed?.stores[shop]
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
  return <section className="private-reviewed-products" aria-label="Mijn persoonlijk gecontroleerde winkelproducten">
    <h2>Mijn echte bronartikelen voor dit weekmenu</h2>
    <p>Alleen jouw zelf gecontroleerde productregels, geen actuele winkelcatalogus of kassagarantie.
      Historische ontwerpvoorbeelden elders op de pagina tellen niet mee.</p>
    {!sources.length ? <p role="status">Nog geen complete en actuele eigen bronproducten beschikbaar.
      Kies een weekmenu, importeer je eigen winkelbron en controleer iedere SKU en verpakking.</p> : <>
      <div className="private-reviewed-products__controls">
        <label>Winkel <select value={store} onChange={event => setStore(event.target.value as 'all' | OwnStore)}>
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
        </select></label>
        <label>Zoek eigen product <input type="search" value={query}
          onChange={event => setQuery(event.target.value)} placeholder="Product, SKU of ingrediënt" /></label>
      </div>
      <div className="private-reviewed-products__progress" aria-label="Mijn nog te kopen artikelen per winkel">
        {shops.filter(shop => store === 'all' || store === shop).map(shop => {
          const capture = reviewed?.stores[shop]
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
            {privatePriceAgeNotice(capture.capturedMs, Date.now()) && (
              <small role="status" className="private-reviewed-products__age">
                {privatePriceAgeNotice(capture.capturedMs, Date.now())}
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
      {store === 'all' && reviewed && <PrivateReviewedTwoStoreTable reviewed={reviewed}
        search={search} unitFilter={unitFilter} order={order} budget={budget}
        onOpenComparison={onOpenComparison} onOpenList={onOpenList}
        onOpenMixedRoute={onOpenMixedRoute} onChooseRouteLine={onChooseRouteLine}
        checked={checked} />}
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
      <button type="button" onClick={() => onOpenList(store === 'all' ? undefined : store)}>
        {store === 'all' ? 'Open mijn gecontroleerde boodschappenlijst' : `Open mijn ${store}-boodschappenlijst`}
      </button>
    </>}
    <button type="button" onClick={onOpenComparison}>Open prijsinvoer en productmatching</button>
    <small>Ontbrekende of verlopen bronproducten krijgen nooit een verzonnen prijs.</small>
  </section>
}
